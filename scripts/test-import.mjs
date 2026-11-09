import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { wrapNodeSqlite } from '../lib/sql.ts';
import { importSiteBatch, openReviewCounts } from '../lib/site-import.ts';
import { accountRows, canonicalSourceId } from '../lib/site-identity.ts';

function database() {
  return wrapNodeSqlite(new DatabaseSync(':memory:'));
}
const sha = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const base = [
  { provisionalKey: 'sheet1-r2', excelRow: 2, sourceSiteId: '42', sourceSiteIdRaw: '42', address: '1 Main', state: 'CO', classification: 'Event', region: 'CO' },
  { provisionalKey: 'sheet1-r3', excelRow: 3, sourceSiteId: '42', sourceSiteIdRaw: '42', address: '1 Main Street, Fictional City, CO 80014', state: 'CO', classification: 'Event', region: 'CO' },
  { provisionalKey: 'sheet1-r4', excelRow: 4, sourceSiteId: '007', sourceSiteIdRaw: '007', address: '7 Zero Lane, Fictional City, CO 80014', state: 'CO', classification: 'Seasonal', region: 'CO' },
  { provisionalKey: 'sheet1-r5', excelRow: 5, sourceSiteId: '7', sourceSiteIdRaw: '7', address: '7 Other Lane, Fictional City, CO 80014', state: 'CO', classification: 'Event', region: 'CO' },
  { provisionalKey: 'sheet1-r9', excelRow: 9, sourceSiteId: '8', sourceSiteIdRaw: '8', address: '8 Plain Street, Fictional City, TX 73301', state: 'TX', classification: 'Event', region: 'TX' },
  { provisionalKey: 'sheet1-r299', excelRow: 299, sourceSiteId: '99', sourceSiteIdRaw: '99', address: '99 Exclusion Street, Washington, DC 20001', state: 'DC', classification: 'Seasonal', region: 'DC' },
];
assert.equal(canonicalSourceId(7).id, '7');
assert.equal(canonicalSourceId('007').id, '007');
assert.deepEqual(accountRows(base), { inputRows: 6, candidates: 5, excludedDc: 1, duplicateIdValues: 1, duplicateRows: 2, addressFlagRows: 1, overlap: 1 });

const db = database();
const first = await importSiteBatch(db, { rows: base, sha256: sha(base), filename: 'fixture.json', now: '2026-11-09T00:00:00.000Z' });
assert.equal(first.noop, false);
assert.equal(first.deletedSites, 0);
assert.equal(first.sitesCreated, 5);
const ids = await db.all('SELECT site_id, source_site_id, address, operational, status, region FROM sites ORDER BY source_site_id, address');
assert.equal(ids.length, 5);
assert.equal(ids.filter((row) => row.source_site_id === '42').length, 2);
assert.equal(new Set(ids.filter((row) => row.source_site_id === '42').map((row) => row.site_id)).size, 2);
assert.equal(ids.find((row) => row.source_site_id === '007').address, '7 Zero Lane, Fictional City, CO 80014');
assert.ok(ids.every((row) => row.operational === 0 && row.status === 'pending_review' && (row.region === 'CO' || row.region === 'TX')));
const counts = await openReviewCounts(db);
assert.equal(counts.dup_source_id, 1);
assert.equal(counts.address_flag, 1);
assert.equal(counts.coverage_excluded, 1);
assert.equal(counts.new_unreviewed, 5);
const dup = await db.get('SELECT candidate_site_ids FROM site_review_queue WHERE reason = ?', 'dup_source_id');
assert.equal(JSON.parse(dup.candidate_site_ids).length, 2);

const again = await importSiteBatch(db, { rows: base, sha256: sha(base), filename: 'fixture.json', now: '2026-11-09T01:00:00.000Z' });
assert.equal(again.noop, true);
assert.equal((await db.all('SELECT site_id FROM sites')).length, 5);
assert.equal((await db.all('SELECT review_id FROM site_review_queue')).length, 1 + 1 + 1 + 5);

const shuffled = base.map((row, index) => ({ ...row, provisionalKey: `sheet1-r${1000 - index}`, excelRow: 1000 - index })).reverse();
const before = new Map((await db.all('SELECT content_fp, site_id FROM sites')).map((row) => [row.content_fp, row.site_id]));
const second = await importSiteBatch(db, { rows: shuffled, sha256: sha(shuffled), filename: 'shuffled.json', now: '2026-11-09T02:00:00.000Z' });
assert.equal(second.noop, false);
assert.equal(second.sitesCreated, 0);
const after = await db.all('SELECT content_fp, site_id, address FROM sites');
for (const row of after) assert.equal(row.site_id, before.get(row.content_fp));
assert.equal((await openReviewCounts(db)).dup_source_id, 1);

const dropped = base.filter((row) => row.sourceSiteId !== '8');
await importSiteBatch(db, { rows: dropped, sha256: sha(dropped), filename: 'dropped.json', now: '2026-11-09T03:00:00.000Z' });
assert.equal((await db.all('SELECT site_id FROM sites')).length, 5);
assert.equal((await openReviewCounts(db)).missing_in_new_batch, 1);

const changed = base.map((row) => row.sourceSiteId === '8' ? { ...row, address: '8 Changed Street, Fictional City, TX 73301', provisionalKey: 'sheet1-r50', excelRow: 50 } : row);
const originalAddress = (await db.get('SELECT address FROM sites WHERE source_site_id = ?', '8')).address;
await importSiteBatch(db, { rows: changed, sha256: sha(changed), filename: 'changed.json', now: '2026-11-09T04:00:00.000Z' });
assert.equal((await db.get('SELECT address FROM sites WHERE source_site_id = ?', '8')).address, originalAddress);
assert.equal((await openReviewCounts(db)).address_changed, 1);
const dcSpaced = [{ ...base[5], state: ' dc ', region: ' dc ' }];
const dcDb = database();
await importSiteBatch(dcDb, { rows: dcSpaced, sha256: sha(dcSpaced), filename: 'dc.json', now: '2026-11-09T05:00:00.000Z' });
assert.equal((await dcDb.all('SELECT site_id FROM sites')).length, 0);
assert.equal((await openReviewCounts(dcDb)).coverage_excluded, 1);
const dupRow = { provisionalKey: 'sheet1-r10', excelRow: 10, sourceSiteId: '15', sourceSiteIdRaw: '15', address: '15 Same Street, Fictional City, CO 80014', state: 'CO', classification: 'Event', region: 'CO' };
const exact = [dupRow, { ...dupRow, provisionalKey: 'sheet1-r11', excelRow: 11 }];
const exactDb = database();
const firstExact = await importSiteBatch(exactDb, { rows: exact, sha256: sha(exact), filename: 'exact.json', now: '2026-11-09T06:00:00.000Z' });
assert.equal(firstExact.sitesCreated, 1);
const changedKeys = exact.map((row, index) => ({ ...row, provisionalKey: `sheet1-r${80 + index}`, excelRow: 80 + index }));
const secondExact = await importSiteBatch(exactDb, { rows: changedKeys, sha256: sha(changedKeys), filename: 'exact-2.json', now: '2026-11-09T07:00:00.000Z' });
assert.equal(secondExact.sitesCreated, 0);
assert.equal((await exactDb.all('SELECT site_id FROM sites')).length, 1);
console.log('Passed: repeated and shuffled imports preserve ids, duplicates stay separate, exclusions and flags remain, absent rows are not deleted, and exact duplicate rows keep one id.');

if (process.env.WINTER_WATCH_XLSX) {
  const { spawnSync } = await import('node:child_process');
  const { rowsFromContract } = await import('../lib/site-identity.ts');
  const read = spawnSync('python3', ['scripts/read-xlsx-rows.py', process.env.WINTER_WATCH_XLSX], { encoding: 'utf8' });
  if (read.status !== 0) throw new Error(read.stderr);
  const workbookRows = rowsFromContract(JSON.parse(read.stdout));
  const accounted = accountRows(workbookRows);
  assert.deepEqual(accounted, { inputRows: 3095, candidates: 3094, excludedDc: 1, duplicateIdValues: 23, duplicateRows: 46, addressFlagRows: 108, overlap: 23 });
  const full = database();
  const fileSha = createHash('sha256').update(read.stdout).digest('hex');
  const imported = await importSiteBatch(full, { rows: workbookRows, sha256: fileSha, filename: 'workbook', now: '2026-11-09T00:00:00.000Z' });
  assert.equal(imported.sitesCreated, 3094);
  assert.equal(imported.excludedDc, 1);
  const repeat = await importSiteBatch(full, { rows: workbookRows, sha256: fileSha, filename: 'workbook', now: '2026-11-09T01:00:00.000Z' });
  assert.equal(repeat.noop, true);
  const reordered = workbookRows.map((row, index) => ({ ...row, provisionalKey: `reordered-${index}`, excelRow: null })).reverse();
  const mapBefore = new Map((await full.all('SELECT content_fp, site_id FROM sites')).map((row) => [row.content_fp, row.site_id]));
  await importSiteBatch(full, { rows: reordered, sha256: sha(reordered), filename: 'reordered', now: '2026-11-09T02:00:00.000Z' });
  const mapAfter = await full.all('SELECT content_fp, site_id FROM sites');
  assert.equal(mapAfter.length, 3094);
  for (const row of mapAfter) assert.equal(row.site_id, mapBefore.get(row.content_fp));
  const fullCounts = await openReviewCounts(full);
  assert.equal(fullCounts.dup_source_id, 23);
  assert.equal(fullCounts.address_flag, 108);
  assert.equal(fullCounts.coverage_excluded, 1);
  assert.equal(await full.get('SELECT COUNT(*) AS count FROM sites WHERE operational = 1').then((row) => row.count), 0);
  console.log('Passed full inventory accounting: 3095 input rows, 3094 unactivated sites, 23 duplicate-id reviews, 108 address flags, 1 DC exclusion. Shuffled lineage keys did not change site ids.');
}
