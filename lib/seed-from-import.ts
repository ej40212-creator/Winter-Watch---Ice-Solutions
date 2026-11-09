import { DatabaseSync } from "node:sqlite";
import { importSiteBatch } from "./site-import.ts";
import type { ImportRow } from "./site-identity.ts";
import { canonicalSeedHash, seedInsertSql, SEED_TABLES, stableUlid, type SeedTable } from "./seed-statements.ts";
import { wrapNodeSqlite } from "./sql.ts";
import type { SqlStatement } from "./sql.ts";

export type SeedPayload = { sha256: string; statements: SqlStatement[] };

export type ReviewedSeedSite = {
  sourceSiteId: string;
  sourceSiteIdRaw?: string;
  provisionalKey?: string;
  address: string;
  state: string;
  classification: string;
};

function insertOrIgnore(table: SeedTable, row: Record<string, unknown>): SqlStatement {
  const columns = SEED_TABLES[table];
  return {
    sql: seedInsertSql(table),
    params: columns.map((column) => row[column] ?? null),
  };
}

/** Build a 1-40 site seed from the workbook importer so fingerprints, lineage, and review flags match a later import. Site, batch, and review ids are derived from the file hash and fingerprint, so regenerating the payload does not mint new rows. */
export async function reviewedSeedStatements(sites: ReviewedSeedSite[], now: string, actor: string): Promise<SeedPayload> {
  if (sites.length < 1 || sites.length > 40) {
    throw new Error("A reviewed D1 load must contain 1 to 40 sites. The full workbook is not loaded this way.");
  }
  const rows: ImportRow[] = sites.map((site, index) => ({
    provisionalKey: site.provisionalKey ?? `seed-${index + 1}-${site.sourceSiteId}`,
    excelRow: null,
    sourceSiteId: site.sourceSiteId,
    sourceSiteIdRaw: site.sourceSiteIdRaw ?? site.sourceSiteId,
    address: site.address,
    state: site.state.trim().toUpperCase(),
    classification: site.classification,
    region: site.state.trim().toUpperCase(),
  }));
  const sha256 = canonicalSeedHash(rows.map((row) => ({
    provisionalKey: row.provisionalKey,
    excelRow: row.excelRow,
    sourceSiteId: row.sourceSiteId,
    sourceSiteIdRaw: row.sourceSiteIdRaw,
    address: row.address,
    state: row.state,
    classification: row.classification,
    region: row.region ?? row.state,
  })));
  const memory = wrapNodeSqlite(new DatabaseSync(":memory:"));
  await importSiteBatch(memory, { rows, sha256, filename: "reviewed-slice.json", actor, now });
  await stabilizeSeedIds(memory, sha256);
  const statements: SqlStatement[] = [];
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${SEED_TABLES.sites.join(",")} FROM sites ORDER BY source_site_id`)) {
    statements.push(insertOrIgnore("sites", row));
  }
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${SEED_TABLES.site_import_batches.join(",")} FROM site_import_batches`)) {
    statements.push(insertOrIgnore("site_import_batches", row));
  }
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${SEED_TABLES.site_source_rows.join(",")} FROM site_source_rows ORDER BY provisional_key`)) {
    statements.push(insertOrIgnore("site_source_rows", row));
  }
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${SEED_TABLES.site_review_queue.join(",")} FROM site_review_queue ORDER BY reason, dedupe_key`)) {
    statements.push(insertOrIgnore("site_review_queue", row));
  }
  return { sha256, statements };
}

async function stabilizeSeedIds(memory: ReturnType<typeof wrapNodeSqlite>, sha256: string): Promise<void> {
  const batch = await memory.get<{ batch_id: string }>("SELECT batch_id FROM site_import_batches");
  if (!batch) return;
  const stableBatch = stableUlid(`${sha256}|batch`);
  await memory.run("UPDATE site_import_batches SET batch_id = ? WHERE batch_id = ?", stableBatch, batch.batch_id);
  await memory.run("UPDATE site_source_rows SET batch_id = ?", stableBatch);
  await memory.run("UPDATE site_review_queue SET batch_id = ?", stableBatch);
  const sites = await memory.all<{ site_id: string; content_fp: string }>("SELECT site_id, content_fp FROM sites");
  const siteMap = new Map(sites.map((site) => [site.site_id, stableUlid(`${sha256}|site|${site.content_fp}`)]));
  const reviews = await memory.all<{ review_id: string; reason: string; dedupe_key: string; site_id: string | null; candidate_site_ids: string | null }>(
    "SELECT review_id, reason, dedupe_key, site_id, candidate_site_ids FROM site_review_queue",
  );
  for (const review of reviews) {
    let dedupe = review.dedupe_key;
    for (const [oldId, next] of siteMap) dedupe = dedupe.split(oldId).join(next);
    let candidates: string | null = null;
    if (review.candidate_site_ids) {
      const parsed = JSON.parse(review.candidate_site_ids) as unknown[];
      candidates = JSON.stringify(parsed.map((id) => typeof id === "string" ? siteMap.get(id) ?? id : id));
    }
    await memory.run(
      "UPDATE site_review_queue SET review_id = ?, site_id = ?, candidate_site_ids = ?, dedupe_key = ? WHERE review_id = ?",
      stableUlid(`${sha256}|review|${review.reason}|${dedupe}`),
      review.site_id ? siteMap.get(review.site_id) ?? review.site_id : null,
      candidates,
      dedupe,
      review.review_id,
    );
  }
  for (const [oldId, next] of siteMap) {
    await memory.run("UPDATE site_source_rows SET site_id = ? WHERE site_id = ?", next, oldId);
    await memory.run("UPDATE sites SET site_id = ? WHERE site_id = ?", next, oldId);
  }
}
