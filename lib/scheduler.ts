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
  status: "busy" | "completed" | "empty";
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

async function recoverExpiredLease(db: Sql, now: number): Promise<number> {
  const running = await db.all<{ cycle_id: string }>("SELECT cycle_id FROM refresh_cycles WHERE status = 'running'");
  if (!running.length) return 0;
  await db.run(
    "UPDATE refresh_cycles SET status = 'abandoned', finished_at = ?, note = 'lease expired before completion' WHERE status = 'running'",
    iso(now),
  );
  const leased = await db.all<{ site_id: string }>("SELECT site_id FROM refresh_jobs WHERE status = 'leased'");
  await db.run(
    "UPDATE refresh_jobs SET status = 'abandoned', finished_at = ?, error = 'lease expired before the job finished' WHERE status = 'leased'",
    iso(now),
  );
  const finished = await db.all<{ site_id: string; finished_at: string | null }>(
    "SELECT site_id, finished_at FROM refresh_jobs WHERE status = 'ok'",
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
  },
): Promise<CycleResult> {
  const now = input.now;
  const owner = input.owner ?? ulid(now);
  const limit = Math.min(MAX_BATCH, Math.max(1, input.limit ?? MAX_BATCH));
  const expires = now + LEASE_MS;
  const acquired = await db.get<{ owner: string }>(
    `INSERT INTO refresh_leases(name, owner, expires_at, cycle_id) VALUES (?, ?, ?, NULL)
     ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at, cycle_id = NULL
     WHERE refresh_leases.expires_at <= ?
     RETURNING owner`,
    LEASE_NAME,
    owner,
    expires,
    now,
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
    };
  }
  let recoveredAbandonedJobs = 0;
  try {
    recoveredAbandonedJobs = await recoverExpiredLease(db, now);
    const states = await db.all<StateRow>("SELECT site_id, last_success_at, next_retry_at, failures FROM site_refresh_state");
    const stateById = new Map(states.map((row) => [row.site_id, row]));
    const due = input.siteIds.filter((siteId) => {
      const state = stateById.get(siteId);
      if (!state) return true;
      if (state.next_retry_at != null && state.next_retry_at > now) return false;
      if (state.last_success_at && (input.dueAfterMs == null || now - Date.parse(state.last_success_at) < input.dueAfterMs)) return false;
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
      input.dueAfterMs == null ? "No recurring due window is configured." : "dueAfterMs was supplied by the caller.",
    );
    await db.run("UPDATE refresh_leases SET cycle_id = ? WHERE name = ? AND owner = ?", cycleId, LEASE_NAME, owner);
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    const failures: CycleResult["failures"] = [];
    let cursor = 0;
    const workers = Math.max(1, Math.min(input.concurrency ?? 4, batch.length || 1));
    async function worker() {
      while (cursor < batch.length) {
        const siteId = batch[cursor++]!;
        const effectToken = `${cycleId}:${siteId}`;
        const inserted = await db.run(
          `INSERT INTO refresh_jobs(cycle_id,site_id,status,attempt,started_at,finished_at,error,effect_token)
           VALUES (?,?,'leased',1,?,NULL,NULL,?)
           ON CONFLICT(cycle_id, site_id) DO NOTHING`,
          cycleId,
          siteId,
          iso(input.now),
          effectToken,
        );
        if (!inserted.changes) {
          skipped += 1;
          continue;
        }
        const effect = await db.run(
          "INSERT INTO refresh_effects(effect_token, site_id, applied_at) VALUES (?,?,?) ON CONFLICT(effect_token) DO NOTHING",
          effectToken,
          siteId,
          iso(input.now),
        );
        if (!effect.changes) {
          skipped += 1;
          await db.run(
            "UPDATE refresh_jobs SET status = 'skipped', finished_at = ?, error = 'effect already recorded' WHERE cycle_id = ? AND site_id = ?",
            iso(input.now),
            cycleId,
            siteId,
          );
          continue;
        }
        const prior = stateById.get(siteId);
        const attempt = (prior?.failures ?? 0) + 1;
        try {
          const outcome = await input.refreshSite(siteId, effectToken);
          const finishedAt = iso(input.now);
          if (outcome.ok) {
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
              input.now + retryDelay("temporary", failuresCount),
            );
          }
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : "Provider refresh failed.";
          const finishedAt = iso(input.now);
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
            input.now + retryDelay("temporary", failuresCount),
          );
        }
      }
    }
    await Promise.all(Array.from({ length: workers }, () => worker()));
    const finishedAt = iso(input.now);
    await db.run(
      "UPDATE refresh_cycles SET status = 'completed', finished_at = ?, ok_count = ?, failed_count = ?, skipped_count = ? WHERE cycle_id = ?",
      finishedAt,
      ok,
      failed,
      skipped,
      cycleId,
    );
    return {
      execution: input.execution ?? "simulation",
      status: batch.length ? "completed" : "empty",
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
    };
  } finally {
    await db.run("DELETE FROM refresh_leases WHERE name = ? AND owner = ?", LEASE_NAME, owner);
  }
}
