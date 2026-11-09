import { ulid } from "./ulid.ts";
import type { Sql } from "./sql.ts";
import { ensurePilotSchema } from "./pilot-schema.ts";
import {
  accountRows,
  addressFlagReasons,
  contentFingerprint,
  normalizeAddress,
  type ImportRow,
} from "./site-identity.ts";

export const CONTRACT_VERSION = "winter-watch-sites-v1";
export const INVENTORY_SOURCE = "ice-solutions-workbook";

type Prepared = ImportRow & { fp: string; flags: string[] };

export type ImportSummary = {
  noop: boolean;
  batchId: string;
  inputRows: number;
  candidates: number;
  excludedDc: number;
  sitesCreated: number;
  sitesReused: number;
  duplicateIdValues: number;
  duplicateRows: number;
  addressFlagRows: number;
  overlap: number;
  reviewInserted: number;
  missingQueued: number;
  deletedSites: number;
};

type Assignment = {
  siteId: string | null;
  method: string;
  created: boolean;
};

function queueReview(
  db: Sql,
  row: {
    reviewId: string;
    batchId: string;
    provisionalKey: string | null;
    siteId: string | null;
    reason: string;
    detail: string;
    candidateSiteIds: string[] | null;
    dedupeKey: string;
    createdAt: string;
  },
) {
  return db.run(
    `INSERT INTO site_review_queue(review_id,batch_id,provisional_key,site_id,reason,detail,candidate_site_ids,dedupe_key,resolution,resolved_by,resolved_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)
     ON CONFLICT(reason, dedupe_key) WHERE resolution IS NULL DO NOTHING`,
    row.reviewId,
    row.batchId,
    row.provisionalKey,
    row.siteId,
    row.reason,
    row.detail,
    row.candidateSiteIds ? JSON.stringify(row.candidateSiteIds) : null,
    row.dedupeKey,
    row.createdAt,
  );
}

export async function importSiteBatch(
  db: Sql,
  input: {
    rows: ImportRow[];
    sha256: string;
    filename: string;
    actor?: string;
    now?: string;
    sourceSystem?: string;
    sheet?: string;
    operational?: boolean;
    dialect?: "sqlite" | "d1";
  },
): Promise<ImportSummary> {
  await ensurePilotSchema(db);
  const sourceSystem = input.sourceSystem ?? INVENTORY_SOURCE;
  const existing = await db.get<{ batch_id: string; summary_json: string }>(
    "SELECT batch_id, summary_json FROM site_import_batches WHERE source_file_sha256 = ?",
    input.sha256,
  );
  if (existing) {
    const prior = JSON.parse(existing.summary_json) as ImportSummary;
    return { ...prior, noop: true, batchId: existing.batch_id, deletedSites: 0 };
  }

  const now = input.now ?? new Date().toISOString();
  const batchId = ulid();
  const operational = input.operational ? 1 : 0;
  const status = input.operational ? "active" : "pending_review";
  const prepared: Prepared[] = input.rows.map((row) => ({
    ...row,
    state: row.state.trim().toUpperCase(),
    fp: contentFingerprint(row.sourceSiteId, row.state.trim().toUpperCase(), row.address),
    flags: row.state.trim().toUpperCase() === "DC" ? [] : addressFlagReasons(row.address),
  }));
  const fpCount = new Map<string, number>();
  for (const row of prepared) fpCount.set(row.fp, (fpCount.get(row.fp) ?? 0) + 1);

  const assignments = new Map<Prepared, Assignment>();
  let sitesCreated = 0;
  let sitesReused = 0;
  let reviewInserted = 0;

  if (input.dialect === "d1") {
    throw new Error("The procedural importer is not a D1 transaction. Load a reviewed 1-40 site slice with applySeedBatch, which commits as one batch.");
  }
  const transactional = true;
  if (transactional) await db.exec("BEGIN");
  try {
    for (const row of prepared) {
      if (row.state === "DC") {
        assignments.set(row, { siteId: null, method: "excluded_dc", created: false });
        continue;
      }
      if ((fpCount.get(row.fp) ?? 0) > 1) {
        const fpMatches = await db.all<{ site_id: string }>(
          "SELECT site_id FROM sites WHERE content_fp = ? AND source_system = ? AND status != 'excluded'",
          row.fp,
          sourceSystem,
        );
        if (fpMatches.length === 1) {
          assignments.set(row, { siteId: fpMatches[0]!.site_id, method: "exact_fp", created: false });
          sitesReused += 1;
          continue;
        }
        if (fpMatches.length > 1) {
          assignments.set(row, { siteId: null, method: "fp_collision", created: false });
          continue;
        }
        const prior = [...assignments.entries()].find(([other, assignment]) => other.fp === row.fp && assignment.siteId);
        if (prior) {
          assignments.set(row, { siteId: prior[1]!.siteId, method: "exact_duplicate_reused", created: false });
          sitesReused += 1;
          continue;
        }
        const siteId = ulid();
        await insertSite(db, row, siteId, sourceSystem, status, operational, now);
        assignments.set(row, { siteId, method: "exact_duplicate", created: true });
        sitesCreated += 1;
        continue;
      }
      const fpMatches = await db.all<{ site_id: string }>(
        "SELECT site_id FROM sites WHERE content_fp = ? AND source_system = ? AND status != 'excluded'",
        row.fp,
        sourceSystem,
      );
      if (fpMatches.length === 1) {
        assignments.set(row, { siteId: fpMatches[0]!.site_id, method: "exact_fp", created: false });
        sitesReused += 1;
        if (await notePresentationChanges(db, fpMatches[0]!.site_id, row, now)) {
          reviewInserted += (
            await queueReview(db, {
              reviewId: ulid(),
              batchId,
              provisionalKey: row.provisionalKey,
              siteId: fpMatches[0]!.site_id,
              reason: "classification_changed",
              detail: "Classification changed on an exact content match. The address was not rewritten.",
              candidateSiteIds: [fpMatches[0]!.site_id],
              dedupeKey: `${fpMatches[0]!.site_id}|${row.classification}`,
              createdAt: now,
            })
          ).changes;
        }
        continue;
      }
      if (fpMatches.length > 1) {
        assignments.set(row, { siteId: null, method: "fp_collision", created: false });
        continue;
      }
      const siblings = prepared.filter(
        (other) => other !== row && other.state === row.state && other.sourceSiteId === row.sourceSiteId,
      );
      const existing = await db.all<{ site_id: string }>(
        "SELECT site_id FROM sites WHERE source_site_id = ? AND state = ? AND source_system = ? AND status != 'excluded'",
        row.sourceSiteId,
        row.state,
        sourceSystem,
      );
      if (siblings.length > 0 || existing.length > 1) {
        const siteId = ulid();
        await insertSite(db, row, siteId, sourceSystem, status, operational, now);
        assignments.set(row, { siteId, method: "kept_separate_duplicate_source_id", created: true });
        sitesCreated += 1;
        continue;
      }
      if (existing.length === 1) {
        assignments.set(row, { siteId: existing[0]!.site_id, method: "id_state_unique_changed", created: false });
        sitesReused += 1;
        continue;
      }
      const siteId = ulid();
      await insertSite(db, row, siteId, sourceSystem, status, operational, now);
      assignments.set(row, { siteId, method: "new", created: true });
      sitesCreated += 1;
    }

    for (const row of prepared) {
      const assignment = assignments.get(row)!;
      await db.run(
        `INSERT INTO site_source_rows(batch_id,provisional_key,excel_row,source_site_id,content_fp,site_id,match_method,review_status,address,state,classification)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        batchId,
        row.provisionalKey,
        row.excelRow,
        row.sourceSiteId,
        row.fp,
        assignment.siteId,
        assignment.method,
        "recorded",
        row.address,
        row.state,
        row.classification,
      );
      if (row.state === "DC") {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: null,
            reason: "coverage_excluded",
            detail: "DC is outside the current coverage set. The row is retained as lineage and was not activated.",
            candidateSiteIds: null,
            dedupeKey: row.fp,
            createdAt: now,
          })
        ).changes;
      }
      if (assignment.created && !input.operational) {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: assignment.siteId,
            reason: "new_unreviewed",
            detail: "New source row. It is not operational until an owner reviews it.",
            candidateSiteIds: assignment.siteId ? [assignment.siteId] : null,
            dedupeKey: assignment.siteId ?? row.fp,
            createdAt: now,
          })
        ).changes;
      }
      if (assignment.method === "exact_duplicate" || assignment.method === "exact_duplicate_reused") {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: assignment.siteId,
            reason: "exact_duplicate",
            detail: "Identical content rows share one site id. A later import reuses that id.",
            candidateSiteIds: assignment.siteId ? [assignment.siteId] : null,
            dedupeKey: row.fp,
            createdAt: now,
          })
        ).changes;
      }
      if (assignment.method === "fp_collision" || assignment.method === "fp_collision_kept_separate") {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: assignment.siteId,
            reason: "fp_collision",
            detail: "Content fingerprint was not unique. Rows were not merged.",
            candidateSiteIds: assignment.siteId ? [assignment.siteId] : null,
            dedupeKey: assignment.siteId ?? row.fp,
            createdAt: now,
          })
        ).changes;
      }
      if (assignment.method === "id_state_unique_changed") {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: assignment.siteId,
            reason: "address_changed",
            detail: "Unique source id and state matched an existing site, but the address fingerprint differs. The stored address was not overwritten.",
            candidateSiteIds: assignment.siteId ? [assignment.siteId] : null,
            dedupeKey: `${assignment.siteId}|${row.fp}`,
            createdAt: now,
          })
        ).changes;
      }
      if (row.region && row.region !== row.state) {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: assignment.siteId,
            reason: "region_mismatch",
            detail: "Source region differed from state. Stored region is the site state, per the approved rule.",
            candidateSiteIds: null,
            dedupeKey: `${row.fp}|region`,
            createdAt: now,
          })
        ).changes;
      }
      if (row.flags.length && assignment.siteId) {
        reviewInserted += (
          await queueReview(db, {
            reviewId: ulid(),
            batchId,
            provisionalKey: row.provisionalKey,
            siteId: assignment.siteId,
            reason: "address_flag",
            detail: row.flags.join(","),
            candidateSiteIds: [assignment.siteId],
            dedupeKey: assignment.siteId,
            createdAt: now,
          })
        ).changes;
      }
    }

    const seen = new Set([...assignments.values()].map((item) => item.siteId).filter((id): id is string => !!id));
    const known = await db.all<{ site_id: string; source_site_id: string; state: string }>(
      "SELECT site_id, source_site_id, state FROM sites WHERE source_system = ?",
      sourceSystem,
    );
    const grouped = new Map<string, string[]>();
    for (const site of known) {
      const key = `${site.source_site_id}|${site.state}`;
      const list = grouped.get(key) ?? [];
      list.push(site.site_id);
      grouped.set(key, list);
    }
    for (const [key, siteIds] of grouped) {
      if (siteIds.length < 2) continue;
      reviewInserted += (
        await queueReview(db, {
          reviewId: ulid(),
          batchId,
          provisionalKey: null,
          siteId: null,
          reason: "dup_source_id",
          detail: `Source id and state ${key} match ${siteIds.length} sites. They were kept separate.`,
          candidateSiteIds: siteIds,
          dedupeKey: `${sourceSystem}|${key}`,
          createdAt: now,
        })
      ).changes;
    }

    let missingQueued = 0;
    for (const site of known) {
      if (seen.has(site.site_id)) continue;
      const changes = (
        await queueReview(db, {
          reviewId: ulid(),
          batchId,
          provisionalKey: null,
          siteId: site.site_id,
          reason: "missing_in_new_batch",
          detail: "Site was absent from this file. It was not deleted.",
          candidateSiteIds: [site.site_id],
          dedupeKey: site.site_id,
          createdAt: now,
        })
      ).changes;
      missingQueued += changes;
      reviewInserted += changes;
    }

    const accounted = accountRows(input.rows);
    const summary: ImportSummary = {
      noop: false,
      batchId,
      inputRows: accounted.inputRows,
      candidates: accounted.candidates,
      excludedDc: accounted.excludedDc,
      sitesCreated,
      sitesReused,
      duplicateIdValues: accounted.duplicateIdValues,
      duplicateRows: accounted.duplicateRows,
      addressFlagRows: accounted.addressFlagRows,
      overlap: accounted.overlap,
      reviewInserted,
      missingQueued,
      deletedSites: 0,
    };
    await db.run(
      `INSERT INTO site_import_batches(batch_id,source_file_sha256,source_filename,sheet,imported_at,imported_by,row_count,contract_version,source_system,status,summary_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      batchId,
      input.sha256,
      input.filename,
      input.sheet ?? null,
      now,
      input.actor ?? "unspecified",
      input.rows.length,
      CONTRACT_VERSION,
      sourceSystem,
      "completed",
      JSON.stringify(summary),
    );
    if (transactional) await db.exec("COMMIT");
    return summary;
  } catch (error) {
    if (transactional) await db.exec("ROLLBACK");
    throw error;
  }
}

async function insertSite(db: Sql, row: Prepared, siteId: string, sourceSystem: string, status: string, operational: number, now: string) {
  await db.run(
    `INSERT INTO sites(site_id,source_system,source_site_id,source_site_id_raw,address,address_normalized,state,region,classification,status,operational,merged_into_site_id,content_fp,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)`,
    siteId,
    sourceSystem,
    row.sourceSiteId,
    row.sourceSiteIdRaw,
    row.address,
    normalizeAddress(row.address),
    row.state,
    row.state,
    row.classification,
    status,
    operational,
    row.fp,
    now,
    now,
  );
}

async function notePresentationChanges(db: Sql, siteId: string, row: Prepared, now: string): Promise<boolean> {
  const current = await db.get<{ classification: string; address: string }>(
    "SELECT classification, address FROM sites WHERE site_id = ?",
    siteId,
  );
  if (!current || current.classification === row.classification) return false;
  await db.run("UPDATE sites SET classification = ?, updated_at = ? WHERE site_id = ?", row.classification, now, siteId);
  return true;
}

export async function openReviewCounts(db: Sql) {
  const rows = await db.all<{ reason: string; count: number }>(
    "SELECT reason, COUNT(*) AS count FROM site_review_queue WHERE resolution IS NULL GROUP BY reason",
  );
  return Object.fromEntries(rows.map((row) => [row.reason, Number(row.count)]));
}
