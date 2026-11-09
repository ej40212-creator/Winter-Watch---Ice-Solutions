import { createHash } from "node:crypto";
import type { Sql, SqlStatement } from "./sql.ts";
import { applySeedBatch } from "./d1-seed.ts";
import { ulid } from "./ulid.ts";

export type SeedCounts = { sites: number; batches: number; sourceRows: number; reviews: number };

const ALLOWED = /^INSERT OR IGNORE INTO (sites|site_import_batches|site_source_rows|site_review_queue)\(/i;

function stableUlid(material: string): string {
  const digest = createHash("sha256").update(material).digest();
  return ulid(0, new Uint8Array(digest.subarray(0, 10)));
}

async function readCounts(db: Sql): Promise<SeedCounts> {
  const row = await db.get<{ sites: number; batches: number; source_rows: number; reviews: number }>(
    `SELECT
       (SELECT COUNT(*) FROM sites) AS sites,
       (SELECT COUNT(*) FROM site_import_batches) AS batches,
       (SELECT COUNT(*) FROM site_source_rows) AS source_rows,
       (SELECT COUNT(*) FROM site_review_queue) AS reviews`,
  );
  return {
    sites: Number(row?.sites ?? 0),
    batches: Number(row?.batches ?? 0),
    sourceRows: Number(row?.source_rows ?? 0),
    reviews: Number(row?.reviews ?? 0),
  };
}

function siteIds(statements: SqlStatement[]): string[] {
  return statements
    .filter((statement) => /^INSERT OR IGNORE INTO sites\(/i.test(statement.sql))
    .map((statement) => String(statement.params[0] ?? ""))
    .filter(Boolean);
}

/**
 * Apply one reviewed seed to the bound database.
 * The pilot rule is to apply once to an empty D1. The same file hash is a no-op.
 * The audit rows are in the same batch as the inserts.
 */
export async function applyHostedSeed(
  db: Sql,
  input: { sha256: string; statements: SqlStatement[]; actor: string; now: string; acknowledgement?: string },
): Promise<{ ok: true; skipped: boolean; counts: SeedCounts } | { ok: false; status: number; error: string; message: string }> {
  if (input.acknowledgement !== "owner-reviewed") {
    return { ok: false, status: 409, error: "not_reviewed", message: "A hosted seed requires acknowledgement owner-reviewed." };
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    return { ok: false, status: 400, error: "invalid_seed", message: "The seed payload needs the importer file hash." };
  }
  if (!Array.isArray(input.statements) || input.statements.length < 1 || input.statements.length > 400) {
    return { ok: false, status: 400, error: "invalid_seed", message: "The seed payload must contain 1 to 400 statements." };
  }
  if (input.statements.some((statement) => !ALLOWED.test(statement.sql) || !Array.isArray(statement.params))) {
    return { ok: false, status: 400, error: "invalid_seed", message: "Seed statements may only insert sites, lineage, and review rows." };
  }
  if (!input.statements.some((statement) => /site_import_batches\(/i.test(statement.sql) && statement.params.includes(input.sha256))) {
    return { ok: false, status: 400, error: "invalid_seed", message: "The file hash must be the hash stored on the import batch." };
  }
  const existing = await db.get<{ batch_id: string }>("SELECT batch_id FROM site_import_batches WHERE source_file_sha256 = ?", input.sha256);
  if (existing) {
    await db.run(
      "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
      ulid(),
      existing.batch_id,
      input.actor,
      "seed_skipped",
      "This file hash is already loaded. No additional rows were written.",
      input.now,
    );
    return { ok: true, skipped: true, counts: await readCounts(db) };
  }
  const counts = await readCounts(db);
  if (counts.sites || counts.batches || counts.sourceRows || counts.reviews) {
    return { ok: false, status: 409, error: "not_empty", message: "Apply a reviewed seed once to an empty D1 database." };
  }
  const audits = siteIds(input.statements).map((siteId) => ({
    sql: "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
    params: [stableUlid(`${input.sha256}|audit|${siteId}`), siteId, input.actor, "seeded_unactivated", "Reviewed seed inserted unactivated. Activation is a separate audited step.", input.now],
  }));
  await applySeedBatch(db, [...input.statements, ...audits]);
  return { ok: true, skipped: false, counts: await readCounts(db) };
}
