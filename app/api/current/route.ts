import { env } from "cloudflare:workers";
import { currentWeather } from "../../../lib/current-weather";
import { syntheticCurrent, syntheticEnabled } from "../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../lib/http";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.json({ error: "Choose a site." }, { status: 400, headers: PRIVATE_NO_STORE });
  if (syntheticEnabled(env as { PILOT_SYNTHETIC_DATA?: string })) {
    const row = syntheticCurrent(key);
    if (!row) return Response.json({ status: "unavailable", execution: "simulation", error: "Unknown synthetic site." }, { status: 404, headers: PRIVATE_NO_STORE });
    return Response.json(row, { headers: PRIVATE_NO_STORE });
  }
  try {
    return Response.json(await currentWeather(key), { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ status: "unavailable", temperature: null, error: "Current observations are unavailable. The site address may need review, or nearby stations may not be reporting. Try again shortly." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
