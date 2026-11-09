import { ulid } from "./ulid.ts";
import type { Sql, SqlStatement } from "./sql.ts";

export type ReviewedSeedSite = {
  sourceSiteId: string;
  address: string;
  state: string;
  classification: string;
};

/** Statements for a reviewed slice. The caller applies them with batch() or one SQL transaction. */
export function reviewedSeedStatements(sites: ReviewedSeedSite[], now: string, actor: string): SqlStatement[] {
  if (sites.length < 1 || sites.length > 40) {
    throw new Error("A reviewed D1 load must contain 1 to 40 sites. The full workbook is not loaded this way.");
  }
  return sites.flatMap((site) => {
    const siteId = ulid();
    const state = site.state.trim().toUpperCase();
    return [
      {
        sql: `INSERT INTO sites(site_id,source_system,source_site_id,source_site_id_raw,address,address_normalized,state,region,classification,status,operational,merged_into_site_id,content_fp,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,'pending_review',0,NULL,?,?,?)`,
        params: [siteId, "reviewed-seed", site.sourceSiteId, site.sourceSiteId, site.address, site.address.toUpperCase(), state, state, site.classification, `seed|${site.sourceSiteId}|${state}`, now, now],
      },
      {
        sql: "INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at) VALUES (?,?,?,?,?,?)",
        params: [ulid(), siteId, actor, "seeded_unactivated", "Reviewed seed inserted unactivated. Activation is a separate audited step.", now],
      },
    ];
  });
}

export function reviewedSeedScript(statements: SqlStatement[]): string {
  const body = statements.map((statement) => {
    const literals = statement.params.map((value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
    let index = 0;
    return statement.sql.replace(/\?/g, () => literals[index++] ?? "NULL") + ";";
  }).join("\n");
  return `${body}\n`;
}

/** One D1 batch, or one sqlite transaction. A thrown statement leaves no partial seed. */
export async function applySeedBatch(db: Sql, statements: SqlStatement[]): Promise<void> {
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  await db.exec("BEGIN");
  try {
    for (const statement of statements) await db.run(statement.sql, ...statement.params);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
