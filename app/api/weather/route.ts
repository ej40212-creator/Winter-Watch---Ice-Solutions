import { env } from "cloudflare:workers";
import { forecast, nationalAlerts, readOutlook, snapshot } from "../../../lib/weather";
import { syntheticOutlook, syntheticSnapshot } from "../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { NOT_RUN, prepareRead } from "../../../lib/api-access";
import { loadActivatedSites } from "../../../lib/site-directory";
import { wrapD1 } from "../../../lib/sql-d1";

async function activatedIds(): Promise<Set<string>> {
  const database = (env as { DB?: D1Database }).DB;
  if (!database) return new Set();
  try {
    const sites = await loadActivatedSites(wrapD1(database));
    return new Set(sites.map((site) => site.key));
  } catch {
    return new Set();
  }
}

export async function GET(request: Request) {
  const gate = await prepareRead(request);
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  try {
    if (gate.synthetic) {
      if (url.searchParams.has("key")) {
        const row = syntheticOutlook(url.searchParams.get("key")!);
        if (!row) return Response.json({ error: "Unknown synthetic site.", execution: "simulation" }, { status: 404, headers: PRIVATE_NO_STORE });
        return Response.json(row, { headers: PRIVATE_NO_STORE });
      }
      if (url.searchParams.has("alerts")) return Response.json({ updated: new Date().toISOString(), execution: "simulation", alerts: [] }, { headers: PRIVATE_NO_STORE });
      return Response.json(syntheticSnapshot(), { headers: PRIVATE_NO_STORE });
    }
    if (url.searchParams.has("key")) {
      const key = url.searchParams.get("key")!;
      const allowed = await activatedIds();
      if (!allowed.has(key)) return Response.json({ error: "That site is not activated.", execution: "not_run" }, { status: 404, headers: PRIVATE_NO_STORE });
      if (!gate.allowLive) {
        let cached = null;
        try { cached = await readOutlook(key); } catch { cached = null; }
        return Response.json(cached ? { ...cached, execution: "cache" } : { key, status: "unavailable", ...NOT_RUN, minTemp: null, alerts: [], hours: [] }, { headers: PRIVATE_NO_STORE });
      }
      return Response.json(await forecast(key, { allowLive: true }), { headers: PRIVATE_NO_STORE });
    }
    if (url.searchParams.has("alerts")) {
      if (!gate.allowLive) return Response.json({ updated: null, alerts: [], ...NOT_RUN }, { headers: PRIVATE_NO_STORE });
      return Response.json(await nationalAlerts(true), { headers: PRIVATE_NO_STORE });
    }
    const allowed = await activatedIds();
    const rows = await snapshot();
    return Response.json(rows.filter((row: { key?: string }) => row.key && allowed.has(row.key)), { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ error: "Weather service is temporarily unavailable. Please retry.", execution: "not_run" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
