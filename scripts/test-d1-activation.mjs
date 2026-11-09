import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { wrapD1 } from '../lib/sql-d1.ts';
import { wrapNodeSqlite } from '../lib/sql.ts';
import { ensurePilotSchema } from '../lib/pilot-schema.ts';
import { importSiteBatch } from '../lib/site-import.ts';
import { activateSite, loadActivatedSites } from '../lib/site-directory.ts';

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
const guarded = {
  async exec(sql) {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) throw new Error(`transaction leaked: ${sql}`);
    return memory.exec(sql);
  },
  run: memory.run.bind(memory),
  get: memory.get.bind(memory),
  all: memory.all.bind(memory),
};
const row = { provisionalKey: 'sheet1-r2', excelRow: 2, sourceSiteId: '3', sourceSiteIdRaw: '3', address: '3 Synthetic Lane, Fictional City, CO 80014', state: 'CO', classification: 'Event', region: 'CO' };
const sha = createHash('sha256').update('d1-row').digest('hex');
const imported = await importSiteBatch(guarded, { rows: [row], sha256: sha, filename: 'd1.json', now: '2026-11-09T00:00:00.000Z', dialect: 'd1' });
assert.equal(imported.sitesCreated, 1);
assert.equal((await loadActivatedSites(guarded)).length, 0);
const site = await guarded.get('SELECT site_id FROM sites');
const refused = await activateSite(guarded, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', now: '2026-11-09T00:01:00.000Z' });
assert.equal(refused.ok, false);
assert.equal((await loadActivatedSites(guarded)).length, 0);
const activated = await activateSite(guarded, { siteId: site.site_id, actor: 'admin@example.com', decision: 'activate', acknowledgement: 'owner-reviewed', now: '2026-11-09T00:02:00.000Z' });
assert.equal(activated.ok, true);
assert.equal((await loadActivatedSites(guarded)).length, 1);
const audit = await guarded.get('SELECT actor, decision FROM site_activation_audit WHERE decision = ?', 'activate');
assert.equal(audit.actor, 'admin@example.com');
console.log('Passed: D1 adapter does not use BEGIN/COMMIT, import can run without those statements, and activation is explicit and audited.');
