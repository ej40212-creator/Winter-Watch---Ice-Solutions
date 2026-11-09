import { env } from "cloudflare:workers";
import { cached } from "../../../lib/weather";
import { syntheticEnabled } from "../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../lib/http";

export async function GET() {
  if (syntheticEnabled(env as { PILOT_SYNTHETIC_DATA?: string })) {
    return Response.json({ lastRun: null, execution: "simulation", message: "No background batch has run. Unattended refresh is not configured." }, { headers: PRIVATE_NO_STORE });
  }
  try {
    return Response.json(await cached("background-status", false) || { lastRun: null }, { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ lastRun: null, error: "Background status is unavailable because D1 is not configured." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
