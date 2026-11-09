import { env } from "cloudflare:workers";
import { syntheticReview } from "../../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../../lib/http";
import { wrapD1 } from "../../../../lib/sql-d1";
import { requireAdmin, syntheticForRequest } from "../../../../lib/api-access";
import { readRuntimeEnv } from "../../../../lib/access-auth";

const ALLOWED = new Set(["keep_separate", "defer"]);

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  if (syntheticForRequest(request, readRuntimeEnv())) {
    return Response.json(syntheticReview(), { headers: PRIVATE_NO_STORE });
  }
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    return Response.json({ error: "configuration_required", message: "D1 is not configured. Review items are not fabricated." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
  try {
    const db = wrapD1(database);
    const items = await db.all("SELECT review_id AS reviewId, reason, detail, candidate_site_ids AS candidateSiteIds, provisional_key AS provisionalKey, site_id AS siteId, resolution, created_at AS createdAt FROM site_review_queue WHERE resolution IS NULL ORDER BY created_at LIMIT 50");
    const counts = await db.all<{ reason: string; count: number }>("SELECT reason, COUNT(*) AS count FROM site_review_queue WHERE resolution IS NULL GROUP BY reason");
    return Response.json({ source: "d1", execution: "database", items, counts }, { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ error: "configuration_required", message: "The review queue table is not available." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const body = await request.json().catch(() => null) as { reviewId?: string; resolution?: string } | null;
  if (!body?.reviewId || !body.resolution || !ALLOWED.has(body.resolution)) {
    return Response.json({ error: "invalid_resolution", message: "Only keep_separate and defer are accepted. Duplicates are not merged and sites are not deleted." }, { status: 400, headers: PRIVATE_NO_STORE });
  }
  if (syntheticForRequest(request, readRuntimeEnv())) {
    const item = syntheticReview().items.find((entry) => entry.reviewId === body.reviewId);
    if (!item) return Response.json({ error: "not_found" }, { status: 404, headers: PRIVATE_NO_STORE });
    return Response.json({ ...item, resolution: body.resolution, execution: "simulation", persisted: false }, { headers: PRIVATE_NO_STORE });
  }
  const database = (env as { DB?: D1Database }).DB;
  if (!database) return Response.json({ error: "configuration_required", message: "D1 is not configured." }, { status: 503, headers: PRIVATE_NO_STORE });
  const db = wrapD1(database);
  const result = await db.run(
    "UPDATE site_review_queue SET resolution = ?, resolved_at = ?, resolved_by = ? WHERE review_id = ? AND resolution IS NULL",
    body.resolution,
    new Date().toISOString(),
    admin.identity.email,
    body.reviewId,
  );
  if (!result.changes) return Response.json({ error: "not_found", message: "That review item is not open." }, { status: 404, headers: PRIVATE_NO_STORE });
  return Response.json({ reviewId: body.reviewId, resolution: body.resolution, execution: "database", persisted: true }, { headers: PRIVATE_NO_STORE });
}
