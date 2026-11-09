import type { Sql, SqlStatement } from "./sql.ts";
import { applySeedBatch } from "./d1-seed.ts";
import { contentFingerprint, normalizeAddress } from "./site-identity.ts";
import { ulid } from "./ulid.ts";
import {
  BATCH_COLUMNS,
  canonicalSeedHash,
  REVIEW_COLUMNS,
  ROW_COLUMNS,
  seedInsertSql,
  SEED_TABLES,
  SITE_COLUMNS,
  stableUlid,
  type CanonicalSeedRow,
  type SeedTable,
} from "./seed-statements.ts";

export type SeedCounts = { sites: number; batches: number; sourceRows: number; reviews: number };

export const SEED_BODY_MAX_BYTES = 256 * 1024;
const INVENTORY_SOURCE = "ice-solutions-workbook";
const CONTRACT_VERSION = "winter-watch-sites-v1";
const AUDIT_SUBJECT = "seed-request";

export function seedEndpointEnabled(value: string | undefined): boolean {
  return value === "enabled";
}

export function parseSeedBody(text: string): { ok: true; sha256: string; statements: SqlStatement[]; acknowledgement?: string } | { ok: false; status: number; error: string; message: string } {
  if (text.length > SEED_BODY_MAX_BYTES) {
    return { ok: false, status: 413, error: "payload_too_large", message: "The seed body is larger than 256 KiB. No statements were applied." };
  }
  let body: { sha256?: string; statements?: SqlStatement[]; acknowledgement?: string };
  try {
    body = JSON.parse(text) as { sha256?: string; statements?: SqlStatement[]; acknowledgement?: string };
  } catch {
    return { ok: false, status: 400, error: "invalid_seed", message: "The seed body is not JSON." };
  }
  return { ok: true, sha256: body?.sha256 ?? "", statements: Array.isArray(body?.statements) ? body.statements : [], acknowledgement: body?.acknowledgement };
}

function columnIndex<T extends readonly string[]>(columns: T, name: T[number]): number {
  return columns.indexOf(name);
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

export async function recordSeedAudit(db: Sql, input: { siteId: string; actor: string; decision: string; note: string; now: string }): Promise<void> {
  try {
    await db.run(
      "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
      ulid(),
      input.siteId,
      input.actor || "unknown",
      input.decision,
      input.note,
      input.now,
    );
  } catch {
    /* A missing audit table must not hide the seed decision. */
  }
}

function classify(statement: SqlStatement): SeedTable | null {
  if (!statement || typeof statement.sql !== "string" || !Array.isArray(statement.params)) return null;
  for (const table of Object.keys(SEED_TABLES) as SeedTable[]) {
    if (statement.sql === seedInsertSql(table) && statement.params.length === SEED_TABLES[table].length) return table;
  }
  return null;
}

type Reject = { ok: false; status: number; error: string; message: string };

/**
 * Apply one reviewed seed to the bound database.
 * Statements must match the importer templates exactly. Sites stay unactivated.
 * The pilot rule is to apply once to an empty D1. The same file hash is a no-op.
 */
export async function applyHostedSeed(
  db: Sql,
  input: { sha256: string; statements: SqlStatement[]; actor: string; now: string; acknowledgement?: string },
): Promise<{ ok: true; skipped: boolean; counts: SeedCounts } | Reject> {
  const reject = async (status: number, error: string, message: string, siteId = AUDIT_SUBJECT): Promise<Reject> => {
    await recordSeedAudit(db, { siteId, actor: input.actor, decision: "seed_rejected", note: message, now: input.now });
    return { ok: false, status, error, message };
  };
  if (input.acknowledgement !== "owner-reviewed") {
    return reject(409, "not_reviewed", "A hosted seed requires acknowledgement owner-reviewed.");
  }
  if (!Array.isArray(input.statements) || input.statements.length < 1) {
    return reject(400, "invalid_seed", "The seed payload must contain the importer statements.");
  }
  const grouped: Record<SeedTable, SqlStatement[]> = { sites: [], site_import_batches: [], site_source_rows: [], site_review_queue: [] };
  for (const statement of input.statements) {
    const table = classify(statement);
    if (!table) return reject(400, "invalid_seed", "Each seed statement must match an importer template. Extra SQL is refused.");
    grouped[table].push(statement);
  }
  if (grouped.sites.length < 1 || grouped.sites.length > 40) {
    return reject(400, "invalid_seed", "A seed batch is limited to 40 sites.");
  }
  if (grouped.site_import_batches.length !== 1 || grouped.site_source_rows.length < 1 || grouped.site_source_rows.length > 40 || grouped.site_review_queue.length > 320) {
    return reject(400, "invalid_seed", "The seed payload must contain one import batch and at most 40 source rows.");
  }

  const siteById = new Map<string, { siteId: string; sourceSiteId: string; sourceSiteIdRaw: string; address: string; state: string; classification: string; region: string; fingerprint: string }>();
  for (const statement of grouped.sites) {
    const param = (name: (typeof SITE_COLUMNS)[number]) => statement.params[columnIndex(SITE_COLUMNS, name)];
    if (param("status") !== "pending_review" || param("operational") !== 0 || param("merged_into_site_id") != null) {
      return reject(400, "invalid_seed", "Seeded sites must stay pending_review and unactivated. Activation is a separate audited step.");
    }
    if (param("source_system") !== INVENTORY_SOURCE) {
      return reject(400, "invalid_seed", "Seeded sites must use the workbook source system.");
    }
    const address = String(param("address") ?? "");
    const state = String(param("state") ?? "");
    const sourceSiteId = String(param("source_site_id") ?? "");
    const fingerprint = contentFingerprint(sourceSiteId, state, address);
    if (param("content_fp") !== fingerprint || param("address_normalized") !== normalizeAddress(address)) {
      return reject(400, "invalid_seed", "The site fingerprint does not match the importer.");
    }
    const siteId = String(param("site_id") ?? "");
    if (!siteId || siteById.has(siteId)) return reject(400, "invalid_seed", "Each seeded site needs its own id.");
    siteById.set(siteId, {
      siteId,
      sourceSiteId,
      sourceSiteIdRaw: String(param("source_site_id_raw") ?? ""),
      address,
      state,
      classification: String(param("classification") ?? ""),
      region: String(param("region") ?? ""),
      fingerprint,
    });
  }

  const canonical: CanonicalSeedRow[] = [];
  for (const statement of grouped.site_source_rows) {
    const param = (name: (typeof ROW_COLUMNS)[number]) => statement.params[columnIndex(ROW_COLUMNS, name)];
    const siteId = String(param("site_id") ?? "");
    const site = siteById.get(siteId);
    if (!site) return reject(400, "invalid_seed", "A source row names a site that is not in this seed.");
    if (param("content_fp") !== site.fingerprint || param("address") !== site.address || param("state") !== site.state || String(param("source_site_id") ?? "") !== site.sourceSiteId) {
      return reject(400, "invalid_seed", "A source row does not match its site.");
    }
    const provisionalKey = String(param("provisional_key") ?? "");
    if (!provisionalKey) return reject(400, "invalid_seed", "A source row is missing its lineage key.");
    const excelRow = param("excel_row");
    canonical.push({
      provisionalKey,
      excelRow: typeof excelRow === "number" ? excelRow : null,
      sourceSiteId: site.sourceSiteId,
      sourceSiteIdRaw: site.sourceSiteIdRaw,
      address: site.address,
      state: site.state,
      classification: site.classification,
      region: site.region,
    });
  }
  const sha256 = canonicalSeedHash(canonical);
  if (input.sha256 !== sha256) {
    return reject(400, "invalid_seed", "The seed hash does not match the reviewed rows.");
  }
  const batch = grouped.site_import_batches[0]!;
  const batchParam = (name: (typeof BATCH_COLUMNS)[number]) => batch.params[columnIndex(BATCH_COLUMNS, name)];
  const batchId = String(batchParam("batch_id") ?? "");
  if (batchParam("source_file_sha256") !== sha256 || batchId !== stableUlid(`${sha256}|batch`) || Number(batchParam("row_count")) !== canonical.length) {
    return reject(400, "invalid_seed", "The import batch does not match the reviewed rows.");
  }
  if (batchParam("source_system") !== INVENTORY_SOURCE || batchParam("contract_version") !== CONTRACT_VERSION || batchParam("status") !== "completed") {
    return reject(400, "invalid_seed", "The import batch is not a completed workbook seed.");
  }
  for (const site of siteById.values()) {
    if (site.siteId !== stableUlid(`${sha256}|site|${site.fingerprint}`)) {
      return reject(400, "invalid_seed", "A site id was not derived from the file hash and fingerprint.");
    }
  }
  for (const statement of grouped.site_review_queue) {
    const param = (name: (typeof REVIEW_COLUMNS)[number]) => statement.params[columnIndex(REVIEW_COLUMNS, name)];
    if (param("resolution") != null || param("resolved_by") != null || param("resolved_at") != null) {
      return reject(400, "invalid_seed", "Seeded reviews must be unresolved. Resolution is a separate audited step.");
    }
    if (String(param("batch_id") ?? "") !== batchId) return reject(400, "invalid_seed", "A review row is not part of this seed batch.");
    const reviewSite = param("site_id") == null ? "" : String(param("site_id"));
    if (reviewSite && !siteById.has(reviewSite)) return reject(400, "invalid_seed", "A review row names a site that is not in this seed.");
    const reason = String(param("reason") ?? "");
    const dedupe = String(param("dedupe_key") ?? "");
    if (String(param("review_id") ?? "") !== stableUlid(`${sha256}|review|${reason}|${dedupe}`)) {
      return reject(400, "invalid_seed", "A review id was not derived from the file hash.");
    }
  }

  const existing = await db.get<{ batch_id: string }>("SELECT batch_id FROM site_import_batches WHERE source_file_sha256 = ?", sha256);
  if (existing) {
    const linked = await db.get<{ site_id: string }>("SELECT site_id FROM site_source_rows WHERE batch_id = ? AND site_id IS NOT NULL", existing.batch_id);
    await recordSeedAudit(db, {
      siteId: linked?.site_id ?? AUDIT_SUBJECT,
      actor: input.actor,
      decision: "seed_skipped",
      note: "This file hash is already loaded. No additional rows were written.",
      now: input.now,
    });
    return { ok: true, skipped: true, counts: await readCounts(db) };
  }
  const counts = await readCounts(db);
  if (counts.sites || counts.batches || counts.sourceRows || counts.reviews) {
    const linked = await db.get<{ site_id: string }>("SELECT site_id FROM sites");
    return reject(409, "not_empty", "Apply a reviewed seed once to an empty D1 database.", linked?.site_id ?? AUDIT_SUBJECT);
  }

  const statements = input.statements.map((statement) => {
    if (statement.sql !== seedInsertSql("site_import_batches")) return statement;
    const params = [...statement.params];
    params[columnIndex(BATCH_COLUMNS, "imported_by")] = input.actor;
    return { sql: statement.sql, params };
  });
  const audits = [...siteById.keys()].map((siteId) => ({
    sql: "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
    params: [stableUlid(`${sha256}|audit|${siteId}`), siteId, input.actor, "seeded_unactivated", "Reviewed seed inserted unactivated. Activation is a separate audited step.", input.now],
  }));
  try {
    await applySeedBatch(db, [...statements, ...audits]);
  } catch (error) {
    await recordSeedAudit(db, {
      siteId: AUDIT_SUBJECT,
      actor: input.actor,
      decision: "seed_failed",
      note: error instanceof Error ? error.message : "The seed batch failed and was not kept.",
      now: input.now,
    });
    return { ok: false, status: 503, error: "configuration_required", message: "The seed batch failed and was not kept." };
  }
  return { ok: true, skipped: false, counts: await readCounts(db) };
}
