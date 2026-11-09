import { readRuntimeEnv } from "../../../lib/access-auth";

export async function POST(request: Request) {
  if (import.meta.env?.DEV !== true) {
    return Response.json({ error: "not_found", message: "Synthetic sign-in is excluded from this build." }, { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const { mintSyntheticSession } = await import("../../../lib/synthetic-session");
  return mintSyntheticSession(request, readRuntimeEnv());
}
