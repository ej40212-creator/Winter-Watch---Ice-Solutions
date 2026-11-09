import { createHash } from "node:crypto";
import { ulid } from "./ulid.ts";

export const SITE_COLUMNS = ["site_id", "source_system", "source_site_id", "source_site_id_raw", "address", "address_normalized", "state", "region", "classification", "status", "operational", "merged_into_site_id", "content_fp", "created_at", "updated_at"] as const;
export const BATCH_COLUMNS = ["batch_id", "source_file_sha256", "source_filename", "sheet", "imported_at", "imported_by", "row_count", "contract_version", "source_system", "status", "summary_json"] as const;
export const ROW_COLUMNS = ["batch_id", "provisional_key", "excel_row", "source_site_id", "content_fp", "site_id", "match_method", "review_status", "address", "state", "classification"] as const;
export const REVIEW_COLUMNS = ["review_id", "batch_id", "provisional_key", "site_id", "reason", "detail", "candidate_site_ids", "dedupe_key", "resolution", "resolved_by", "resolved_at", "created_at"] as const;

export const SEED_TABLES = {
  sites: SITE_COLUMNS,
  site_import_batches: BATCH_COLUMNS,
  site_source_rows: ROW_COLUMNS,
  site_review_queue: REVIEW_COLUMNS,
} as const;

export type SeedTable = keyof typeof SEED_TABLES;

export function seedInsertSql(table: SeedTable): string {
  const columns = SEED_TABLES[table];
  return `INSERT OR IGNORE INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
}

export function stableUlid(material: string): string {
  const digest = createHash("sha256").update(material).digest();
  return ulid(0, new Uint8Array(digest.subarray(0, 10)));
}

export type CanonicalSeedRow = {
  provisionalKey: string;
  excelRow: number | null;
  sourceSiteId: string;
  sourceSiteIdRaw: string;
  address: string;
  state: string;
  classification: string;
  region: string;
};

/** Hash of the reviewed rows in provisional-key order. Regenerating the same rows produces this hash. */
export function canonicalSeedHash(rows: CanonicalSeedRow[]): string {
  const canon = [...rows].sort((a, b) => a.provisionalKey.localeCompare(b.provisionalKey)).map((row) => ({
    provisionalKey: row.provisionalKey,
    excelRow: row.excelRow,
    sourceSiteId: row.sourceSiteId,
    sourceSiteIdRaw: row.sourceSiteIdRaw,
    address: row.address,
    state: row.state,
    classification: row.classification,
    region: row.region,
  }));
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}
