import { env } from "cloudflare:workers";
import { requireAdmin } from "../../../../lib/api-access";
import { PRIVATE_NO_STORE } from "../../../../lib/http";
import { applyHostedSeed } from "../../../../lib/seed-apply";
import type { SqlStatement } from "../../../../lib/sql";
import { wrapD1 } from "../../../../lib/sql-d1";

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const body = await request.json().catch(() => null) as { sha256?: string; statements?: SqlStatement[]; acknowledgement?: string } | null;
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    return Response.json({ error: "configuration_required", message: "D1 is not configured. No seed was applied." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
  try {
    const result = await applyHostedSeed(wrapD1(database), {
      sha256: body?.sha256 ?? "",
      statements: body?.statements ?? [],
      actor: admin.identity.email,
      now: new Date().toISOString(),
      acknowledgement: body?.acknowledgement,
    });
    if (!result.ok) return Response.json({ error: result.error, message: result.message }, { status: result.status, headers: PRIVATE_NO_STORE });
    return Response.json({ skipped: result.skipped, counts: result.counts, actor: admin.identity.email, execution: "database" }, { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ error: "configuration_required", message: "The seed batch failed and was not kept. Read the counts again before retrying." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
