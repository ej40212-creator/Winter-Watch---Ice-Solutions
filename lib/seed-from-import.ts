import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { importSiteBatch } from "./site-import.ts";
import type { ImportRow } from "./site-identity.ts";
import { wrapNodeSqlite } from "./sql.ts";
import type { SqlStatement } from "./sql.ts";

export type ReviewedSeedSite = {
  sourceSiteId: string;
  sourceSiteIdRaw?: string;
  provisionalKey?: string;
  address: string;
  state: string;
  classification: string;
};

const SITE_COLUMNS = ["site_id", "source_system", "source_site_id", "source_site_id_raw", "address", "address_normalized", "state", "region", "classification", "status", "operational", "merged_into_site_id", "content_fp", "created_at", "updated_at"];
const BATCH_COLUMNS = ["batch_id", "source_file_sha256", "source_filename", "sheet", "imported_at", "imported_by", "row_count", "contract_version", "source_system", "status", "summary_json"];
const ROW_COLUMNS = ["batch_id", "provisional_key", "excel_row", "source_site_id", "content_fp", "site_id", "match_method", "review_status", "address", "state", "classification"];
const REVIEW_COLUMNS = ["review_id", "batch_id", "provisional_key", "site_id", "reason", "detail", "candidate_site_ids", "dedupe_key", "resolution", "resolved_by", "resolved_at", "created_at"];

function insertOrIgnore(table: string, columns: string[], row: Record<string, unknown>): SqlStatement {
  return {
    sql: `INSERT OR IGNORE INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    params: columns.map((column) => row[column] ?? null),
  };
}

/** Build a 1-40 site seed from the workbook importer so fingerprints, lineage, and review flags match a later import. */
export async function reviewedSeedStatements(sites: ReviewedSeedSite[], now: string, actor: string): Promise<SqlStatement[]> {
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
  const sha256 = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const memory = wrapNodeSqlite(new DatabaseSync(":memory:"));
  await importSiteBatch(memory, { rows, sha256, filename: "reviewed-slice.json", actor, now });
  const statements: SqlStatement[] = [];
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${SITE_COLUMNS.join(",")} FROM sites ORDER BY source_site_id`)) {
    statements.push(insertOrIgnore("sites", SITE_COLUMNS, row));
  }
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${BATCH_COLUMNS.join(",")} FROM site_import_batches`)) {
    statements.push(insertOrIgnore("site_import_batches", BATCH_COLUMNS, row));
  }
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${ROW_COLUMNS.join(",")} FROM site_source_rows ORDER BY provisional_key`)) {
    statements.push(insertOrIgnore("site_source_rows", ROW_COLUMNS, row));
  }
  for (const row of await memory.all<Record<string, unknown>>(`SELECT ${REVIEW_COLUMNS.join(",")} FROM site_review_queue ORDER BY reason, dedupe_key`)) {
    statements.push(insertOrIgnore("site_review_queue", REVIEW_COLUMNS, row));
  }
  return statements;
}
