import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyHostedSeed, parseSeedBody, SEED_BODY_MAX_BYTES, seedEndpointEnabled } from '../lib/seed-apply.ts';
import { reviewedSeedStatements } from '../lib/seed-from-import.ts';
import { seedInsertSql, SITE_COLUMNS } from '../lib/seed-statements.ts';
import { ensurePilotSchema } from '../lib/pilot-schema.ts';
import { wrapNodeSqlite } from '../lib/sql.ts';

assert.equal(seedEndpointEnabled(undefined), false);
assert.equal(seedEndpointEnabled('1'), false);
assert.equal(seedEndpointEnabled('enabled'), true);
const oversized = parseSeedBody('x'.repeat(SEED_BODY_MAX_BYTES + 1));
assert.equal(oversized.ok, false);
assert.equal(oversized.status, 413);

const input = [{ sourceSiteId: 'S1', provisionalKey: 'seed-s1', address: '1 Fictional Campus, Example City, CO 80014', state: 'CO', classification: 'Event' }];
const seed = await reviewedSeedStatements(input, '2026-11-09T00:00:00.000Z', 'generator');

async function database() {
  const db = wrapNodeSqlite(new DatabaseSync(':memory:'));
  await ensurePilotSchema(db);
  return db;
}

async function attempt(statements, sha = seed.sha256) {
  const db = await database();
  return applyHostedSeed(db, { sha256: sha, statements, actor: 'admin@example.com', now: '2026-11-09T00:00:00.000Z', acknowledgement: 'owner-reviewed' });
}

const active = structuredClone(seed.statements);
const site = active.find((statement) => statement.sql === seedInsertSql('sites'));
site.params[SITE_COLUMNS.indexOf('status')] = 'active';
site.params[SITE_COLUMNS.indexOf('operational')] = 1;
const activeResult = await attempt(active);
assert.equal(activeResult.ok, false);
assert.equal(activeResult.status, 400);
assert.match(activeResult.message, /pending_review/);
const activeDb = await database();
await applyHostedSeed(activeDb, { sha256: seed.sha256, statements: active, actor: 'admin@example.com', now: '2026-11-09T00:00:00.000Z', acknowledgement: 'owner-reviewed' });
assert.equal((await activeDb.get("SELECT decision FROM site_activation_audit WHERE decision = 'seed_rejected'")).decision, 'seed_rejected');
assert.equal(await activeDb.get("SELECT site_id FROM sites WHERE status = 'active'"), undefined);

const extra = await attempt([...seed.statements, { sql: 'INSERT OR IGNORE INTO sites(site_id) VALUES (?)', params: ['extra'] }]);
assert.equal(extra.ok, false);
assert.match(extra.message, /template/);

const select = await attempt([{ sql: 'INSERT OR IGNORE INTO sites(site_id) SELECT site_id FROM sites', params: [] }]);
assert.equal(select.ok, false);
assert.match(select.message, /template/);

const tooMany = Array.from({ length: 41 }, () => ({ sql: seedInsertSql('sites'), params: SITE_COLUMNS.map(() => null) }));
const capped = await attempt(tooMany);
assert.equal(capped.ok, false);
assert.match(capped.message, /40 sites/);

const resolved = structuredClone(seed.statements);
const review = resolved.find((statement) => statement.sql === seedInsertSql('site_review_queue'));
review.params[review.params.length - 4] = 'keep_separate';
const preResolved = await attempt(resolved);
assert.equal(preResolved.ok, false);
assert.match(preResolved.message, /unresolved/);

console.log('Passed: seed bypasses are refused for an active site, extra SQL, INSERT SELECT, more than 40 sites, a pre-resolved review, and an oversized body.');
