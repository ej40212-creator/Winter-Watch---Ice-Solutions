import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { wrapNodeSqlite } from '../lib/sql.ts';
import { ensurePilotSchema } from '../lib/pilot-schema.ts';
import { MAX_BATCH, runBoundedCycle } from '../lib/scheduler.ts';
import { retryDelay } from '../lib/coverage.ts';

async function database() {
  const sql = wrapNodeSqlite(new DatabaseSync(':memory:'));
  await ensurePilotSchema(sql);
  return sql;
}

const held = database();
let release;
const gate = new Promise((resolve) => { release = resolve; });
const calls = [];
const sql = await held;
const first = runBoundedCycle(sql, {
  now: 1_700_000_000_000,
  siteIds: ['site-a'],
  execution: 'simulation',
  refreshSite: async (siteId, effectToken) => {
    calls.push({ siteId, effectToken });
    await gate;
    return { ok: true };
  },
});
await new Promise((resolve) => setTimeout(resolve, 30));
const second = await runBoundedCycle(sql, {
  now: 1_700_000_000_000,
  siteIds: ['site-a'],
  execution: 'simulation',
  refreshSite: async () => { calls.push({ siteId: 'duplicate' }); return { ok: true }; },
});
assert.equal(second.status, 'busy');
assert.equal(calls.length, 1);
release();
const finished = await first;
assert.equal(finished.execution, 'simulation');
assert.equal(finished.ok, 1);
assert.equal(calls.filter((call) => call.siteId === 'site-a').length, 1);

const batchDb = await database();
const many = Array.from({ length: 45 }, (_, index) => `site-${index}`);
const seen = new Set();
const capped = await runBoundedCycle(batchDb, {
  now: 1_700_000_000_000,
  siteIds: many,
  execution: 'simulation',
  concurrency: 4,
  refreshSite: async (siteId, effectToken) => {
    if (seen.has(effectToken)) throw new Error(`duplicate effect ${effectToken}`);
    seen.add(effectToken);
    return { ok: true };
  },
});
assert.equal(MAX_BATCH, 40);
assert.equal(capped.processed, 40);
assert.equal(capped.remainingDue, 5);
assert.equal(seen.size, 40);

const failDb = await database();
const now = 1_700_000_000_000;
const failed = await runBoundedCycle(failDb, {
  now,
  clock: () => now,
  siteIds: ['site-fail'],
  execution: 'simulation',
  refreshSite: async () => ({ ok: false, error: 'Simulated provider failure' }),
});
assert.equal(failed.failed, 1);
assert.equal(failed.failures[0].error, 'Simulated provider failure');
assert.ok(failed.failures[0].finishedAt);
const state = await failDb.get('SELECT last_failure_at, last_success_at, next_retry_at FROM site_refresh_state WHERE site_id = ?', 'site-fail');
assert.equal(state.last_success_at, null);
assert.equal(state.next_retry_at, now + retryDelay('temporary', 1));
const skipped = await runBoundedCycle(failDb, { now: now + 1000, siteIds: ['site-fail'], execution: 'simulation', refreshSite: async () => { throw new Error('should not run'); } });
assert.equal(skipped.processed, 0);
const retried = await runBoundedCycle(failDb, {
  now: state.next_retry_at,
  siteIds: ['site-fail'],
  execution: 'simulation',
  refreshSite: async () => ({ ok: true }),
});
assert.equal(retried.ok, 1);

const recoverDb = await database();
await recoverDb.run("INSERT INTO refresh_cycles(cycle_id,started_at,finished_at,sites_due,batch_limit,ok_count,failed_count,skipped_count,status,note) VALUES ('old','2026-01-01T00:00:00.000Z',NULL,2,40,0,0,0,'running','crashed')");
await recoverDb.run("INSERT INTO refresh_jobs(cycle_id,site_id,status,attempt,started_at,finished_at,error,effect_token) VALUES ('old','done','ok',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:01:00.000Z',NULL,'old:done')");
await recoverDb.run("INSERT INTO refresh_jobs(cycle_id,site_id,status,attempt,started_at,finished_at,error,effect_token) VALUES ('old','retry','leased',1,'2026-01-01T00:00:00.000Z',NULL,NULL,'old:retry')");
await recoverDb.run("INSERT INTO refresh_leases(name,owner,expires_at,cycle_id) VALUES ('fleet','crashed',1,'old')");
const recoveredCalls = [];
const recovered = await runBoundedCycle(recoverDb, {
  now: 1_700_000_000_000,
  siteIds: ['done', 'retry'],
  execution: 'simulation',
  refreshSite: async (siteId) => { recoveredCalls.push(siteId); return { ok: true }; },
});
assert.deepEqual(recoveredCalls, ['retry']);
assert.equal(recovered.recoveredAbandonedJobs, 1);
assert.equal((await recoverDb.get("SELECT status FROM refresh_cycles WHERE cycle_id = 'old'")).status, 'abandoned');
const other = await recoverDb.get("SELECT status FROM refresh_cycles WHERE cycle_id != 'old' AND status = 'abandoned'");
assert.equal(other, undefined);

const stealDb = await database();
const stolen = [];
await runBoundedCycle(stealDb, {
  now: 1_700_000_000_000,
  siteIds: ['first', 'second'],
  concurrency: 1,
  execution: 'simulation',
  refreshSite: async (siteId) => {
    stolen.push(siteId);
    if (siteId === 'first') await stealDb.run("UPDATE refresh_leases SET owner = 'thief' WHERE name = 'fleet'");
    return { ok: true };
  },
});
assert.deepEqual(stolen, ['first']);

let tick = 1_700_000_000_000;
const clockDb = await database();
await runBoundedCycle(clockDb, {
  now: tick,
  siteIds: ['timed'],
  execution: 'simulation',
  clock: () => { tick += 1000; return tick; },
  refreshSite: async () => ({ ok: true }),
});
const timed = await clockDb.get('SELECT started_at, finished_at FROM refresh_jobs');
assert.notEqual(timed.started_at, timed.finished_at);

const windowDb = await database();
await runBoundedCycle(windowDb, { now: tick, siteIds: ['held-site'], execution: 'simulation', refreshSite: async () => ({ ok: true }) });
const windowed = await runBoundedCycle(windowDb, { now: tick + 10_000, siteIds: ['held-site'], execution: 'simulation', refreshSite: async () => { throw new Error('should stay held'); } });
assert.equal(windowed.processed, 0);
assert.equal(windowed.heldForUnsetDueWindow, 1);

let live = 10_000_000_000_000;
const clock = () => live;
const takeoverDb = await database();
let releaseGate;
const takeoverGate = new Promise((resolve) => { releaseGate = resolve; });
const firstCalls = [];
const running = runBoundedCycle(takeoverDb, {
  now: live,
  clock,
  siteIds: ['slow', 'later'],
  concurrency: 1,
  execution: 'simulation',
  refreshSite: async (siteId) => {
    firstCalls.push(siteId);
    if (siteId === 'slow') {
      live += 181_000;
      await takeoverGate;
    }
    return { ok: true };
  },
});
await new Promise((resolve) => setTimeout(resolve, 40));
const takeover = await runBoundedCycle(takeoverDb, {
  now: live,
  clock,
  siteIds: ['other'],
  execution: 'simulation',
  refreshSite: async () => ({ ok: true }),
});
assert.equal(takeover.busy, false);
assert.equal(takeover.status, 'completed');
releaseGate();
const abandoned = await running;
assert.equal(abandoned.status, 'abandoned');
const slowEffect = await takeoverDb.get("SELECT effect_token FROM refresh_effects WHERE site_id = 'slow'");
assert.equal(slowEffect, undefined);

let renewedLive = 60_000_000_000_000;
const renewDb = await database();
let markRenewed;
const renewed = new Promise((resolve) => { markRenewed = resolve; });
let releaseHold;
const hold = new Promise((resolve) => { releaseHold = resolve; });
const renewing = runBoundedCycle(renewDb, {
  now: renewedLive,
  clock: () => renewedLive,
  siteIds: ['one', 'two'],
  concurrency: 1,
  execution: 'simulation',
  refreshSite: async (siteId) => {
    if (siteId === 'one') renewedLive += 181_000;
    if (siteId === 'two') {
      markRenewed();
      await hold;
    }
    return { ok: true };
  },
});
await renewed;
const refused = await runBoundedCycle(renewDb, {
  now: renewedLive,
  clock: () => renewedLive,
  siteIds: ['intruder'],
  execution: 'simulation',
  refreshSite: async () => ({ ok: true }),
});
assert.equal(refused.status, 'busy');
assert.equal(refused.busy, true);
releaseHold();
const renewedResult = await renewing;
assert.equal(renewedResult.status, 'completed');
assert.equal(renewedResult.ok, 2);
console.log('Passed: scheduler lease, batch cap, backoff, expired-lease recovery, stolen lease, job timestamps, unset due window, a live clock past 180s, and a renewal that refuses takeover. These cycles are simulated and did not call a provider.');
