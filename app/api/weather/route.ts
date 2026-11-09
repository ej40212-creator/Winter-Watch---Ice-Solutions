import { env } from "cloudflare:workers";
import { forecast, nationalAlerts, snapshot } from "../../../lib/weather";
import { syntheticEnabled, syntheticOutlook, syntheticSnapshot } from "../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    if (syntheticEnabled(env as { PILOT_SYNTHETIC_DATA?: string })) {
      if (url.searchParams.has("key")) {
        const row = syntheticOutlook(url.searchParams.get("key")!);
        if (!row) return Response.json({ error: "Unknown synthetic site.", execution: "simulation" }, { status: 404, headers: PRIVATE_NO_STORE });
        return Response.json(row, { headers: PRIVATE_NO_STORE });
      }
      if (url.searchParams.has("alerts")) {
        return Response.json({ updated: new Date().toISOString(), execution: "simulation", alerts: [] }, { headers: PRIVATE_NO_STORE });
      }
      return Response.json(syntheticSnapshot(), { headers: PRIVATE_NO_STORE });
    }
    if (url.searchParams.has("key")) return Response.json(await forecast(url.searchParams.get("key")!), { headers: PRIVATE_NO_STORE });
    if (url.searchParams.has("alerts")) return Response.json(await nationalAlerts(), { headers: PRIVATE_NO_STORE });
    return Response.json(await snapshot(), { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ error: "Weather service is temporarily unavailable. Please retry.", execution: "not_run" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
