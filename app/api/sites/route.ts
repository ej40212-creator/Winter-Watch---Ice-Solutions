import { env } from "cloudflare:workers";
import { prepareRead } from "../../../lib/api-access";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { loadActivatedSites } from "../../../lib/site-directory";
import { wrapD1 } from "../../../lib/sql-d1";
import syntheticSites from "../../../fixtures/synthetic-sites.json";

export async function GET(request: Request) {
  const gate = await prepareRead(request);
  if (gate instanceof Response) return gate;
  if (gate.synthetic) {
    return Response.json({ mode: "synthetic", execution: "simulation", sites: syntheticSites }, { headers: PRIVATE_NO_STORE });
  }
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    return Response.json({ mode: "empty", execution: "not_run", sites: [], message: "D1 is not configured. No inventory is shown." }, { headers: PRIVATE_NO_STORE });
  }
  try {
    const sites = await loadActivatedSites(wrapD1(database));
    return Response.json({ mode: sites.length ? "activated" : "empty", execution: "database", sites }, { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ mode: "empty", execution: "not_run", sites: [], message: "D1 is not ready. No activated sites are shown." }, { headers: PRIVATE_NO_STORE });
  }
}
