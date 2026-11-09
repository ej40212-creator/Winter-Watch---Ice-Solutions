import { env } from "cloudflare:workers";
import { performanceHistory } from "../../../lib/telemetry";
import { syntheticEnabled } from "../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../lib/http";

export async function GET() {
  if (syntheticEnabled(env as { PILOT_SYNTHETIC_DATA?: string })) {
    return Response.json({
      checkedAt: new Date().toISOString(),
      buckets: [],
      execution: "simulation",
      note: "No refresh history has been measured. Empty buckets are not a sample chart.",
    }, { headers: PRIVATE_NO_STORE });
  }
  try {
    return Response.json(await performanceHistory(), { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ error: "Performance history is not available. No measurements were fabricated.", execution: "not_run" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
