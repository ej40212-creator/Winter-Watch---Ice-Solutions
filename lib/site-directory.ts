import type { Sql } from "./sql.ts";
import type { SiteRecord } from "./sites-data.ts";

export async function loadActivatedSites(db: Sql): Promise<SiteRecord[]> {
  const rows = await db.all<{ key: string; id: string; region: string; address: string; state: string; classification: string }>(
    "SELECT site_id AS key, source_site_id AS id, region, address, state, classification FROM sites WHERE operational = 1 AND status = 'active' ORDER BY state, source_site_id",
  );
  return rows.map((row) => ({ ...row, demo: false }));
}

export async function activateSite(
  db: Sql,
  input: { siteId: string; actor: string; decision: string; acknowledgement?: string; now: string },
): Promise<{ ok: true; operational: number } | { ok: false; status: number; error: string; message: string }> {
  if (!input.actor) return { ok: false, status: 403, error: "forbidden", message: "Activation requires the verified admin email." };
  if (input.decision !== "activate" && input.decision !== "leave_unactivated") {
    return { ok: false, status: 400, error: "invalid_decision", message: "Decision must be activate or leave_unactivated." };
  }
  const site = await db.get<{ site_id: string }>("SELECT site_id FROM sites WHERE site_id = ?", input.siteId);
  if (!site) return { ok: false, status: 404, error: "not_found", message: "That site is not in the imported inventory." };
  const acknowledged = input.acknowledgement === "owner-reviewed";
  const operational = input.decision === "activate" && acknowledged ? 1 : 0;
  if (input.decision === "activate" && !acknowledged) {
    await db.run(
      "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
      `audit-${input.now}-${input.siteId}`,
      input.siteId,
      input.actor,
      "rejected",
      "Activation refused because acknowledgement was not owner-reviewed.",
      input.now,
    );
    return { ok: false, status: 409, error: "not_reviewed", message: "Activation requires acknowledgement owner-reviewed. The site stays unactivated." };
  }
  if (operational === 1) {
    await db.run("UPDATE sites SET operational = 1, status = 'active', updated_at = ? WHERE site_id = ?", input.now, input.siteId);
  }
  await db.run(
    "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
    `audit-${input.decision}-${input.now}-${input.siteId}`,
    input.siteId,
    input.actor,
    input.decision,
    operational === 1 ? "Explicit admin activation." : "Left unactivated.",
    input.now,
  );
  return { ok: true, operational };
}
