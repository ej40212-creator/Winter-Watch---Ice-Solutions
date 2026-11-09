import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { wrapD1 } from '../lib/sql-d1.ts';
import { wrapNodeSqlite } from '../lib/sql.ts';
import { ensurePilotSchema } from '../lib/pilot-schema.ts';
import { importSiteBatch } from '../lib/site-import.ts';
import { activateSite, loadActivatedSites } from '../lib/site-directory.ts';
import { applySeedBatch } from '../lib/d1-seed.ts';
import { reviewedSeedStatements } from '../lib/seed-from-import.ts';
import { applyHostedSeed } from '../lib/seed-apply.ts';
import { contentFingerprint } from '../lib/site-identity.ts';
import { consumeProviderCall } from '../lib/provider-budget.ts';

const statements = [];
const fake = {
  async exec(sql) {
    statements.push(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) throw new Error(`D1 should not receive ${sql}`);
  },
  prepare(sql) {
    return { bind() { return { async run() { statements.push(sql); return { meta: { changes: 1 } }; }, async first() { return null; }, async all() { return { results: [] }; } }; } };
  },
};
const adapted = wrapD1(fake);
await adapted.exec('SELECT 1');
await adapted.run('INSERT INTO example(id) VALUES (?)', 'a');
assert.equal(statements.some((sql) => /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)), false);

const memory = wrapNodeSqlite(new DatabaseSync(':memory:'));
await ensurePilotSchema(memory);
const row = { provisionalKey: 'sheet1-r2', excelRow: 2, sourceSiteId: '3', sourceSiteIdRaw: '3', address: '3 Synthetic Lane, Fictional City, CO 80014', state: 'CO', classification: 'Event', region: 'CO' };
const sha = createHash('sha256').update('d1-row').digest('hex');
const imported = await importSiteBatch(memory, { rows: [row], sha256: sha, filename: 'd1.json', now: '2026-11-09T00:00:00.000Z' });
assert.equal(imported.sitesCreated, 1);
assert.equal((await loadActivatedSites(memory)).length, 0);
const site = await memory.get('SELECT site_id FROM sites');
await memory.run("INSERT INTO site_review_queue(review_id,batch_id,provisional_key,site_id,reason,detail,candidate_site_ids,dedupe_key,created_at) VALUES ('r','b',NULL,?, 'address_flag','flag',NULL,'d','2026-11-09T00:00:00.000Z')", site.site_id);
const blocked = await activateSite(memory, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', acknowledgement: 'owner-reviewed', now: '2026-11-09T00:01:00.000Z' });
assert.equal(blocked.ok, false);
await memory.run("UPDATE site_review_queue SET resolution = 'defer' WHERE review_id = 'r'");
const deferred = await activateSite(memory, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', acknowledgement: 'owner-reviewed', now: '2026-11-09T00:02:00.000Z' });
assert.equal(deferred.ok, false);
assert.equal(deferred.error, 'open_review');
await memory.run("UPDATE site_review_queue SET resolution = 'keep_separate' WHERE review_id = 'r'");
await memory.run("INSERT INTO site_review_queue(review_id,batch_id,provisional_key,site_id,reason,detail,candidate_site_ids,dedupe_key,created_at) VALUES ('dup','b',NULL,?, 'exact_duplicate','same content',NULL,'dup-key','2026-11-09T00:00:00.000Z')", site.site_id);
const duplicateBlocked = await activateSite(memory, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', acknowledgement: 'owner-reviewed', now: '2026-11-09T00:02:30.000Z' });
assert.equal(duplicateBlocked.ok, false);
await memory.run("UPDATE site_review_queue SET resolution = 'keep_separate' WHERE review_id = 'dup'");
await memory.run("INSERT INTO site_review_queue(review_id,batch_id,provisional_key,site_id,reason,detail,candidate_site_ids,dedupe_key,created_at) VALUES ('miss','b',NULL,?, 'missing_in_new_batch','absent',NULL,'miss-key','2026-11-09T00:00:00.000Z')", site.site_id);
const missingBlocked = await activateSite(memory, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', acknowledgement: 'owner-reviewed', now: '2026-11-09T00:02:40.000Z' });
assert.equal(missingBlocked.ok, false);
await memory.run("UPDATE site_review_queue SET resolution = 'keep_separate' WHERE review_id = 'miss'");
const activated = await activateSite(memory, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', acknowledgement: 'owner-reviewed', now: '2026-11-09T00:03:00.000Z' });
assert.equal(activated.ok, true);
assert.equal((await loadActivatedSites(memory)).length, 1);
const deactivated = await activateSite(memory, { siteId: site.site_id, actor: 'admin@example.com', decision: 'deactivate', now: '2026-11-09T00:04:00.000Z' });
assert.equal(deactivated.operational, 0);
assert.equal((await loadActivatedSites(memory)).length, 0);
assert.equal(await consumeProviderCall(memory, 0, 1), true);
assert.equal(await consumeProviderCall(memory, 0, 1), false);

const seedDb = wrapNodeSqlite(new DatabaseSync(':memory:'));
await ensurePilotSchema(seedDb);
const seedInput = [
  { sourceSiteId: 'S1', provisionalKey: 'seed-s1', address: '1 Fictional Campus, Example City, CO 80014', state: 'CO', classification: 'Event' },
  { sourceSiteId: 'S2', provisionalKey: 'seed-s2', address: '2 Fictional Campus, Example City, MN 55101', state: 'MN', classification: 'Seasonal' },
];
const seed = await reviewedSeedStatements(seedInput, '2026-11-09T00:00:00.000Z', 'seed-test');
const regenerated = await reviewedSeedStatements(seedInput, '2026-11-09T02:00:00.000Z', 'seed-test');
assert.equal(seed.sha256, regenerated.sha256);
assert.deepEqual(seed.statements.filter((statement) => statement.sql.includes('INTO sites(')).map((statement) => statement.params[0]), regenerated.statements.filter((statement) => statement.sql.includes('INTO sites(')).map((statement) => statement.params[0]));
assert.deepEqual(seed.statements.filter((statement) => statement.sql.includes('site_review_queue')).map((statement) => statement.params[0]), regenerated.statements.filter((statement) => statement.sql.includes('site_review_queue')).map((statement) => statement.params[0]));
const hosted = await applyHostedSeed(seedDb, { sha256: seed.sha256, statements: seed.statements, actor: 'admin@example.com', now: '2026-11-09T00:00:00.000Z', acknowledgement: 'owner-reviewed' });
assert.equal(hosted.ok, true);
assert.equal(hosted.skipped, false);
assert.equal((await seedDb.get('SELECT imported_by FROM site_import_batches')).imported_by, 'admin@example.com');
assert.equal(hosted.counts.sites, 2);
assert.equal(hosted.counts.batches, 1);
assert.equal(hosted.counts.sourceRows, 2);
const replay = await applyHostedSeed(seedDb, { sha256: regenerated.sha256, statements: regenerated.statements, actor: 'seed-test', now: '2026-11-09T02:00:00.000Z', acknowledgement: 'owner-reviewed' });
assert.equal(replay.skipped, true);
assert.equal(replay.counts.reviews, hosted.counts.reviews);
assert.equal(replay.counts.sourceRows, hosted.counts.sourceRows);
const skippedAudit = await seedDb.get("SELECT site_id FROM site_activation_audit WHERE decision = 'seed_skipped'");
const batchId = (await seedDb.get('SELECT batch_id FROM site_import_batches')).batch_id;
assert.notEqual(skippedAudit.site_id, batchId);
assert.equal((await seedDb.all('SELECT site_id FROM sites')).some((row) => row.site_id === skippedAudit.site_id), true);
const other = await reviewedSeedStatements([{ sourceSiteId: 'S3', provisionalKey: 'seed-s3', address: '3 Fictional Campus, Example City, TX 73301', state: 'TX', classification: 'Event' }], '2026-11-09T03:00:00.000Z', 'seed-test');
const refused = await applyHostedSeed(seedDb, { sha256: other.sha256, statements: other.statements, actor: 'seed-test', now: '2026-11-09T03:00:00.000Z', acknowledgement: 'owner-reviewed' });
assert.equal(refused.ok, false);
assert.equal(refused.status, 409);
const seeded = await seedDb.all('SELECT site_id, content_fp, source_system FROM sites ORDER BY source_site_id');
assert.equal(seeded.length, 2);
assert.equal(seeded[0].content_fp, contentFingerprint('S1', 'CO', seedInput[0].address));
assert.equal(seeded[0].source_system, 'ice-solutions-workbook');
assert.equal((await seedDb.all("SELECT reason FROM site_review_queue WHERE reason = 'new_unreviewed'")).length, 2);
assert.equal((await loadActivatedSites(seedDb)).length, 0);
const again = await importSiteBatch(seedDb, {
  rows: seedInput.map((site) => ({ provisionalKey: site.provisionalKey, excelRow: null, sourceSiteId: site.sourceSiteId, sourceSiteIdRaw: site.sourceSiteId, address: site.address, state: site.state, classification: site.classification, region: site.state })),
  sha256: 'second-file',
  filename: 'again.json',
  now: '2026-11-09T01:00:00.000Z',
});
assert.equal(again.sitesCreated, 0);
assert.equal(again.sitesReused, 2);
assert.equal((await seedDb.all('SELECT site_id FROM sites')).length, 2);
const failing = wrapNodeSqlite(new DatabaseSync(':memory:'));
await ensurePilotSchema(failing);
await assert.rejects(() => applySeedBatch(failing, [...seed.statements, { sql: "INSERT INTO sites(site_id,source_system,source_site_id,source_site_id_raw,address,address_normalized,state,region,classification,status,operational,merged_into_site_id,content_fp,created_at,updated_at) VALUES ('PROBE-R5','reviewed-seed','PROBE-R5','PROBE-R5','probe','PROBE','CO','CO','Event','pending_review',0,NULL,'probe-fp','2026-11-09T00:00:00.000Z','2026-11-09T00:00:00.000Z')", params: [] }, { sql: 'INSERT INTO missing_table(id) VALUES (?)', params: ['x'] }]));
assert.equal((await failing.get("SELECT COUNT(*) AS n FROM sites WHERE source_site_id = 'PROBE-R5'")).n, 0);
assert.equal((await failing.all('SELECT site_id FROM sites')).length, 0);
console.log('Passed: D1 adapter avoids implicit BEGIN, activation is audited and reversible, the budget counter is atomic, and a failed seed batch rolls back.');
