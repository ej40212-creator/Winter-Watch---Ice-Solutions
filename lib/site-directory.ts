import { ulid } from "./ulid.ts";
import type { Sql, SqlStatement } from "./sql.ts";
import type { SiteRecord } from "./sites-data.ts";

const BLOCKING_REASONS = new Set(["dup_source_id", "address_flag", "address_changed", "fp_collision", "exact_duplicate", "missing_in_new_batch"]);

export async function loadActivatedSites(db: Sql): Promise<SiteRecord[]> {
  const rows = await db.all<{ key: string; id: string; region: string; address: string; state: string; classification: string }>(
    "SELECT site_id AS key, source_site_id AS id, region, address, state, classification FROM sites WHERE operational = 1 AND status = 'active' ORDER BY state, source_site_id",
  );
  return rows.map((row) => ({ ...row, demo: false }));
}

async function openBlock(db: Sql, siteId: string): Promise<string | null> {
  const rows = await db.all<{ reason: string; site_id: string | null; candidate_site_ids: string | null }>(
    "SELECT reason, site_id, candidate_site_ids FROM site_review_queue WHERE resolution IS NULL OR resolution = 'defer'",
  );
  for (const row of rows) {
    if (!BLOCKING_REASONS.has(row.reason)) continue;
    if (row.site_id === siteId) return row.reason;
    try {
      const candidates = JSON.parse(row.candidate_site_ids || "[]") as unknown;
      if (Array.isArray(candidates) && candidates.includes(siteId)) return row.reason;
    } catch { /* ignore malformed candidate lists */ }
  }
  return null;
}

async function writePair(db: Sql, statements: SqlStatement[]): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await db.run(statement.sql, ...statement.params);
}

export async function activateSite(
  db: Sql,
  input: { siteId: string; actor: string; decision: string; acknowledgement?: string; now: string },
): Promise<{ ok: true; operational: number } | { ok: false; status: number; error: string; message: string }> {
  if (!input.actor) return { ok: false, status: 403, error: "forbidden", message: "Activation requires the verified admin email." };
  if (!["activate", "deactivate", "leave_unactivated"].includes(input.decision)) {
    return { ok: false, status: 400, error: "invalid_decision", message: "Decision must be activate, deactivate, or leave_unactivated." };
  }
  const site = await db.get<{ site_id: string; status: string; merged_into_site_id: string | null }>(
    "SELECT site_id, status, merged_into_site_id FROM sites WHERE site_id = ?",
    input.siteId,
  );
  if (!site) return { ok: false, status: 404, error: "not_found", message: "That site is not in the imported inventory." };
  if (site.status === "excluded" || site.status === "merged" || site.merged_into_site_id) {
    return { ok: false, status: 409, error: "not_activatable", message: "Excluded or merged sites cannot be activated." };
  }
  const blocking = input.decision === "activate" ? await openBlock(db, input.siteId) : null;
  if (blocking) {
    await db.run(
      "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
      ulid(),
      input.siteId,
      input.actor,
      "rejected",
      `Open review item: ${blocking}`,
      input.now,
    );
    return { ok: false, status: 409, error: "open_review", message: `Activation is blocked by an open ${blocking} review. The site stays unactivated.` };
  }
  if (input.decision === "activate" && input.acknowledgement !== "owner-reviewed") {
    await db.run(
      "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
      ulid(),
      input.siteId,
      input.actor,
      "rejected",
      "Activation refused because acknowledgement was not owner-reviewed.",
      input.now,
    );
    return { ok: false, status: 409, error: "not_reviewed", message: "Activation requires acknowledgement owner-reviewed. The site stays unactivated." };
  }
  const operational = input.decision === "activate" ? 1 : 0;
  const status = input.decision === "activate" ? "active" : "pending_review";
  const note = input.decision === "activate" ? "Explicit admin activation." : input.decision === "deactivate" ? "Explicit admin deactivation." : "Left unactivated.";
  if (input.decision === "leave_unactivated") {
    await db.run(
      "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
      ulid(),
      input.siteId,
      input.actor,
      input.decision,
      note,
      input.now,
    );
    return { ok: true, operational: 0 };
  }
  await writePair(db, [
    { sql: "UPDATE sites SET operational = ?, status = ?, updated_at = ? WHERE site_id = ?", params: [operational, status, input.now, input.siteId] },
    { sql: "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)", params: [ulid(), input.siteId, input.actor, input.decision, note, input.now] },
  ]);
  return { ok: true, operational };
}
