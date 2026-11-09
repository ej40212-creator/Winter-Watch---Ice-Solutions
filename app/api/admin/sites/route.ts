import { env } from "cloudflare:workers";
import { requireAdmin } from "../../../../lib/api-access";
import { PRIVATE_NO_STORE } from "../../../../lib/http";
import { activateSite } from "../../../../lib/site-directory";
import { wrapD1 } from "../../../../lib/sql-d1";

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const body = await request.json().catch(() => null) as { siteId?: string; decision?: string; acknowledgement?: string } | null;
  if (!body?.siteId || !body.decision) {
    return Response.json({ error: "invalid_decision", message: "siteId and decision are required." }, { status: 400, headers: PRIVATE_NO_STORE });
  }
  const database = (env as { DB?: D1Database }).DB;
  if (!database) return Response.json({ error: "configuration_required", message: "D1 is not configured. No site was activated." }, { status: 503, headers: PRIVATE_NO_STORE });
  const result = await activateSite(wrapD1(database), {
    siteId: body.siteId,
    actor: admin.identity.email,
    decision: body.decision,
    acknowledgement: body.acknowledgement,
    now: new Date().toISOString(),
  });
  if (!result.ok) return Response.json({ error: result.error, message: result.message }, { status: result.status, headers: PRIVATE_NO_STORE });
  return Response.json({ siteId: body.siteId, operational: result.operational, actor: admin.identity.email, execution: "database" }, { headers: PRIVATE_NO_STORE });
}
