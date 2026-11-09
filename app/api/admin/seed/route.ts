import { env } from "cloudflare:workers";
import { readRuntimeEnv } from "../../../../lib/access-auth";
import { requireAdmin } from "../../../../lib/api-access";
import { PRIVATE_NO_STORE } from "../../../../lib/http";
import { applyHostedSeed, parseSeedBody, seedEndpointEnabled } from "../../../../lib/seed-apply";
import { wrapD1 } from "../../../../lib/sql-d1";

export async function POST(request: Request) {
  const enabled = seedEndpointEnabled((env as { SEED_ENDPOINT_ENABLED?: string }).SEED_ENDPOINT_ENABLED ?? readRuntimeEnv().SEED_ENDPOINT_ENABLED);
  if (!enabled) {
    return Response.json({ error: "configuration_required", message: "The seed endpoint is disabled. Set SEED_ENDPOINT_ENABLED=enabled for the one-time load, then unset it." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const parsed = parseSeedBody(await request.text());
  if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers: PRIVATE_NO_STORE });
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    return Response.json({ error: "configuration_required", message: "D1 is not configured. No seed was applied." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
  const result = await applyHostedSeed(wrapD1(database), {
    sha256: parsed.sha256,
    statements: parsed.statements,
    actor: admin.identity.email,
    now: new Date().toISOString(),
    acknowledgement: parsed.acknowledgement,
  });
  if (!result.ok) return Response.json({ error: result.error, message: result.message }, { status: result.status, headers: PRIVATE_NO_STORE });
  return Response.json({ skipped: result.skipped, counts: result.counts, actor: admin.identity.email, execution: "database" }, { headers: PRIVATE_NO_STORE });
}
