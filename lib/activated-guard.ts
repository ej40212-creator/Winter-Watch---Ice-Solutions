import { env } from "cloudflare:workers";
import { PRIVATE_NO_STORE } from "./http.ts";
import { loadActivatedSites } from "./site-directory.ts";
import { wrapD1 } from "./sql-d1.ts";

/** Cache reads are limited to sites that are currently activated. A lookup failure does not return cached rows. */
export async function refuseInactiveSite(key: string): Promise<Response | null> {
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    return Response.json({ error: "That site is not activated.", execution: "not_run" }, { status: 404, headers: PRIVATE_NO_STORE });
  }
  try {
    const sites = await loadActivatedSites(wrapD1(database));
    if (!sites.some((site) => site.key === key)) {
      return Response.json({ error: "That site is not activated.", execution: "not_run" }, { status: 404, headers: PRIVATE_NO_STORE });
    }
    return null;
  } catch {
    return Response.json(
      { error: "configuration_required", message: "D1 is bound but the pilot schema is not applied, or the sites query failed. No cached site data was returned.", execution: "not_run" },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
}
