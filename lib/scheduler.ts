import { retryDelay } from "./coverage.ts";
import type { Sql } from "./sql.ts";
import { ulid } from "./ulid.ts";

/** Hard cap from the existing batch design. Not a provider budget. */
export const MAX_BATCH = 40;
export const LEASE_MS = 180_000;
const LEASE_NAME = "fleet";

export type RefreshOutcome = { ok: boolean; error?: string };

export type CycleResult = {
  execution: "simulation" | "provider";
  status: "busy" | "completed" | "empty" | "abandoned";
  cycleId: string | null;
  busy: boolean;
  batchLimit: number;
  sitesDue: number;
  processed: number;
  ok: number;
  failed: number;
  skipped: number;
  remainingDue: number;
  startedAt: string | null;
  finishedAt: string | null;
  failures: { siteId: string; error: string; finishedAt: string }[];
  recoveredAbandonedJobs: number;
  heldForUnsetDueWindow: number;
  delivery: "at-least-once";
};

type StateRow = {
  site_id: string;
  last_success_at: string | null;
  next_retry_at: number | null;
  failures: number;
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function recoverExpiredCycle(db: Sql, cycleId: string | null, now: number): Promise<number> {
  if (!cycleId) return 0;
  await db.run(
    "UPDATE refresh_cycles SET status = 'abandoned', finished_at = ?, note = 'lease expired before completion' WHERE cycle_id = ? AND status = 'running'",
    iso(now),
    cycleId,
  );
  const leased = await db.all<{ site_id: string }>("SELECT site_id FROM refresh_jobs WHERE cycle_id = ? AND status = 'leased'", cycleId);
  await db.run(
    "UPDATE refresh_jobs SET status = 'abandoned', finished_at = ?, error = 'lease expired before the job finished' WHERE cycle_id = ? AND status = 'leased'",
    iso(now),
    cycleId,
  );
  const finished = await db.all<{ site_id: string; finished_at: string | null }>(
    "SELECT site_id, finished_at FROM refresh_jobs WHERE cycle_id = ? AND status = 'ok'",
    cycleId,
  );
  for (const job of finished) {
    await db.run(
      `INSERT INTO site_refresh_state(site_id,last_attempt_at,last_success_at,last_failure_at,last_error,failures,next_retry_at)
       VALUES (?,?,?,NULL,NULL,0,NULL)
       ON CONFLICT(site_id) DO UPDATE SET last_success_at = COALESCE(site_refresh_state.last_success_at, excluded.last_success_at)`,
      job.site_id,
      job.finished_at,
      job.finished_at,
    );
  }
  return leased.length;
}

export async function runBoundedCycle(
  db: Sql,
  input: {
    now: number;
    siteIds: string[];
    refreshSite: (siteId: string, effectToken: string) => Promise<RefreshOutcome>;
    dueAfterMs?: number | null;
    limit?: number;
    owner?: string;
    execution?: "simulation" | "provider";
    concurrency?: number;
    clock?: () => number;
  },
): Promise<CycleResult> {
  const now = input.now;
  const clock = input.clock ?? (() => Date.now());
  const owner = input.owner ?? ulid(now);
  const limit = Math.min(MAX_BATCH, Math.max(1, input.limit ?? MAX_BATCH));
  const leaseNow = clock();
  const expires = leaseNow + LEASE_MS;
  const previous = await db.get<{ cycle_id: string | null; expires_at: number }>("SELECT cycle_id, expires_at FROM refresh_leases WHERE name = ?", LEASE_NAME);
  const acquired = await db.get<{ owner: string }>(
    `INSERT INTO refresh_leases(name, owner, expires_at, cycle_id) VALUES (?, ?, ?, NULL)
     ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at, cycle_id = NULL
     WHERE refresh_leases.expires_at <= ?
     RETURNING owner`,
    LEASE_NAME,
    owner,
    expires,
    leaseNow,
  );
  if (!acquired || acquired.owner !== owner) {
    return {
      execution: input.execution ?? "simulation",
      status: "busy",
      cycleId: null,
      busy: true,
      batchLimit: limit,
      sitesDue: 0,
      processed: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      remainingDue: 0,
      startedAt: null,
      finishedAt: null,
      failures: [],
      recoveredAbandonedJobs: 0,
      heldForUnsetDueWindow: 0,
      delivery: "at-least-once",
    };
  }
  let recoveredAbandonedJobs = 0;
  try {
    recoveredAbandonedJobs = previous && previous.expires_at <= leaseNow ? await recoverExpiredCycle(db, previous.cycle_id, leaseNow) : 0;
    const states = await db.all<StateRow>("SELECT site_id, last_success_at, next_retry_at, failures FROM site_refresh_state");
    const stateById = new Map(states.map((row) => [row.site_id, row]));
    let heldForUnsetDueWindow = 0;
    const due = input.siteIds.filter((siteId) => {
      const state = stateById.get(siteId);
      if (!state) return true;
      if (state.next_retry_at != null && state.next_retry_at > now) return false;
      if (state.last_success_at) {
        if (input.dueAfterMs == null) {
          heldForUnsetDueWindow += 1;
          return false;
        }
        return now - Date.parse(state.last_success_at) >= input.dueAfterMs;
      }
      return true;
    });
    due.sort();
    const batch = due.slice(0, limit);
    const cycleId = ulid(now);
    const startedAt = iso(now);
    await db.run(
      `INSERT INTO refresh_cycles(cycle_id,started_at,finished_at,sites_due,batch_limit,ok_count,failed_count,skipped_count,status,note)
       VALUES (?,?,NULL,?,?,0,0,0,'running',?)`,
      cycleId,
      startedAt,
      due.length,
      limit,
      input.dueAfterMs == null ? "Due window is unset. Successful sites are held, not forgotten. Delivery is at-least-once if a call finishes and the process stops before the effect row is written." : "dueAfterMs was supplied by the caller. Delivery is at-least-once across a crash.",
    );
    await db.run("UPDATE refresh_leases SET cycle_id = ? WHERE name = ? AND owner = ?", cycleId, LEASE_NAME, owner);
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    const failures: CycleResult["failures"] = [];
    let cursor = 0;
    let lostLease = false;
    const workers = Math.max(1, Math.min(input.concurrency ?? 4, batch.length || 1));
    async function worker() {
      while (cursor < batch.length) {
        const siteId = batch[cursor++]!;
        const tick = clock();
        const owned = await db.run(
          "UPDATE refresh_leases SET expires_at = ? WHERE name = ? AND owner = ?",
          tick + LEASE_MS,
          LEASE_NAME,
          owner,
        );
        if (!owned.changes) {
          lostLease = true;
          break;
        }
        const effectToken = `${cycleId}:${siteId}`;
        const startedAtJob = iso(clock());
        const inserted = await db.run(
          `INSERT INTO refresh_jobs(cycle_id,site_id,status,attempt,started_at,finished_at,error,effect_token)
           VALUES (?,?,'leased',1,?,NULL,NULL,?)
           ON CONFLICT(cycle_id, site_id) DO NOTHING`,
          cycleId,
          siteId,
          startedAtJob,
          effectToken,
        );
        if (!inserted.changes) {
          skipped += 1;
          continue;
        }
        const prior = stateById.get(siteId);
        const attempt = (prior?.failures ?? 0) + 1;
        try {
          const outcome = await input.refreshSite(siteId, effectToken);
          const finishedAt = iso(clock());
          const still = await db.get<{ owner: string }>("SELECT owner FROM refresh_leases WHERE name = ?", LEASE_NAME);
          if (!still || still.owner !== owner) {
            lostLease = true;
            await db.run(
              "UPDATE refresh_jobs SET status = 'abandoned', finished_at = ?, error = 'lease lost during the provider call' WHERE cycle_id = ? AND site_id = ?",
              finishedAt,
              cycleId,
              siteId,
            );
            break;
          }
          if (outcome.ok) {
            await db.run(
              "INSERT INTO refresh_effects(effect_token, site_id, applied_at) VALUES (?,?,?) ON CONFLICT(effect_token) DO NOTHING",
              effectToken,
              siteId,
              finishedAt,
            );
            ok += 1;
            await db.run(
              "UPDATE refresh_jobs SET status = 'ok', finished_at = ?, attempt = ? WHERE cycle_id = ? AND site_id = ?",
              finishedAt,
              attempt,
              cycleId,
              siteId,
            );
            await db.run(
              `INSERT INTO site_refresh_state(site_id,last_attempt_at,last_success_at,last_failure_at,last_error,failures,next_retry_at)
               VALUES (?,?,?,NULL,NULL,0,NULL)
               ON CONFLICT(site_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at, failures = 0, next_retry_at = NULL, last_error = NULL`,
              siteId,
              finishedAt,
              finishedAt,
            );
          } else {
            failed += 1;
            const error = outcome.error || "Provider refresh failed.";
            failures.push({ siteId, error, finishedAt });
            const failuresCount = (prior?.failures ?? 0) + 1;
            await db.run(
              "UPDATE refresh_jobs SET status = 'failed', finished_at = ?, error = ?, attempt = ? WHERE cycle_id = ? AND site_id = ?",
              finishedAt,
              error,
              failuresCount,
              cycleId,
              siteId,
            );
            await db.run(
              `INSERT INTO site_refresh_state(site_id,last_attempt_at,last_success_at,last_failure_at,last_error,failures,next_retry_at)
               VALUES (?,?,NULL,?,?,?,?)
               ON CONFLICT(site_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_failure_at = excluded.last_failure_at, last_error = excluded.last_error, failures = excluded.failures, next_retry_at = excluded.next_retry_at`,
              siteId,
              finishedAt,
              finishedAt,
              error,
              failuresCount,
              clock() + retryDelay("temporary", failuresCount),
            );
          }
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : "Provider refresh failed.";
          const finishedAt = iso(clock());
          failures.push({ siteId, error: message, finishedAt });
          const failuresCount = (prior?.failures ?? 0) + 1;
          await db.run(
            "UPDATE refresh_jobs SET status = 'failed', finished_at = ?, error = ?, attempt = ? WHERE cycle_id = ? AND site_id = ?",
            finishedAt,
            message,
            failuresCount,
            cycleId,
            siteId,
          );
          await db.run(
            `INSERT INTO site_refresh_state(site_id,last_attempt_at,last_success_at,last_failure_at,last_error,failures,next_retry_at)
             VALUES (?,?,NULL,?,?,?,?)
             ON CONFLICT(site_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_failure_at = excluded.last_failure_at, last_error = excluded.last_error, failures = excluded.failures, next_retry_at = excluded.next_retry_at`,
            siteId,
            finishedAt,
            finishedAt,
            message,
            failuresCount,
            clock() + retryDelay("temporary", failuresCount),
          );
        }
      }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()));
    const finishedAt = iso(clock());
    const cycleStatus = lostLease ? "abandoned" : batch.length ? "completed" : "empty";
    await db.run(
      "UPDATE refresh_cycles SET status = ?, finished_at = ?, ok_count = ?, failed_count = ?, skipped_count = ?, note = COALESCE(note, '') || ? WHERE cycle_id = ?",
      cycleStatus,
      finishedAt,
      ok,
      failed,
      skipped,
      lostLease ? " Lease lost before the cycle finished." : "",
      cycleId,
    );
    return {
      execution: input.execution ?? "simulation",
      status: cycleStatus,
      cycleId,
      busy: false,
      batchLimit: limit,
      sitesDue: due.length,
      processed: ok + failed,
      ok,
      failed,
      skipped,
      remainingDue: Math.max(0, due.length - batch.length),
      startedAt,
      finishedAt,
      failures,
      recoveredAbandonedJobs,
      heldForUnsetDueWindow,
      delivery: "at-least-once",
    };
  } finally {
    await db.run("DELETE FROM refresh_leases WHERE name = ? AND owner = ?", LEASE_NAME, owner);
  }
}
