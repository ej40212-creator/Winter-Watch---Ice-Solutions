import { performanceHistory } from "../../../lib/telemetry";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { requireAdmin, syntheticForRequest } from "../../../lib/api-access";
import { readRuntimeEnv } from "../../../lib/access-auth";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  if (syntheticForRequest(request, readRuntimeEnv())) {
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
