import { refreshBatch } from "../../../lib/background";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { requireAdmin } from "../../../lib/api-access";

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const result = await refreshBatch();
  const status = result.status === "not_authorized" ? 409 : result.status === "configuration_required" ? 503 : 200;
  return Response.json(result, { status, headers: PRIVATE_NO_STORE });
}

export async function GET() {
  return Response.json({ error: "configuration_required", message: "Manual refresh is an admin POST. GET does not start provider calls." }, { status: 405, headers: PRIVATE_NO_STORE });
}
