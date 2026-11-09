import { applySeedBatch, reviewedSeedStatements, type ReviewedSeedSite } from "../lib/d1-seed.ts";
import { wrapD1 } from "../lib/sql-d1.ts";

type Env = { DB: Parameters<typeof wrapD1>[0] };

/** Local-only evidence worker. It is not the application entrypoint. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const db = wrapD1(env.DB);
    if (url.pathname === "/rollback") {
      const site: ReviewedSeedSite = {
        sourceSiteId: "SHOULD-NOT-LAND",
        address: "9 Fictional Campus, Example City, CO 80014",
        state: "CO",
        classification: "Event",
      };
      try {
        await applySeedBatch(db, [
          ...reviewedSeedStatements([site], new Date().toISOString(), "evidence"),
          { sql: "INSERT INTO does_not_exist(id) VALUES (?)", params: ["x"] },
        ]);
        return Response.json({ committed: true });
      } catch (error) {
        const leftover = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sites WHERE source_site_id = ?", "SHOULD-NOT-LAND");
        return Response.json({
          committed: false,
          leftover: leftover?.n ?? null,
          error: error instanceof Error ? error.message : "batch failed",
        });
      }
    }
    const sites = await request.json() as ReviewedSeedSite[];
    await applySeedBatch(db, reviewedSeedStatements(sites, new Date().toISOString(), "evidence"));
    const count = await db.get<{ sites: number; activated: number | null }>("SELECT COUNT(*) AS sites, SUM(operational) AS activated FROM sites");
    return Response.json({ ok: true, ...count });
  },
};
