import { applySeedBatch } from "../lib/d1-seed.ts";
import { wrapD1 } from "../lib/sql-d1.ts";
import type { SqlStatement } from "../lib/sql.ts";

type Env = { DB: Parameters<typeof wrapD1>[0] };

/** Local-only evidence worker. It applies a prebuilt batch and is not the application entrypoint. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const db = wrapD1(env.DB);
    const body = await request.json() as { statements?: SqlStatement[]; fail?: boolean };
    const statements = body.statements ?? [];
    if (body.fail) {
      statements.push({
        sql: `INSERT INTO sites(site_id,source_system,source_site_id,source_site_id_raw,address,address_normalized,state,region,classification,status,operational,merged_into_site_id,content_fp,created_at,updated_at)
              VALUES ('PROBE-R5','reviewed-seed','PROBE-R5','PROBE-R5','probe','PROBE','CO','CO','Event','pending_review',0,NULL,'probe-fp','2026-11-09T00:00:00.000Z','2026-11-09T00:00:00.000Z')`,
        params: [],
      });
      statements.push({ sql: "INSERT INTO does_not_exist(id) VALUES (?)", params: ["x"] });
    }
    try {
      await applySeedBatch(db, statements);
      const count = await db.get<{ sites: number; activated: number | null }>("SELECT COUNT(*) AS sites, SUM(operational) AS activated FROM sites");
      return Response.json({ ok: true, ...count });
    } catch (error) {
      const leftover = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sites WHERE source_site_id = ?", "PROBE-R5");
      return Response.json({
        committed: false,
        leftover: leftover?.n ?? null,
        error: error instanceof Error ? error.message : "batch failed",
      });
    }
  },
};
