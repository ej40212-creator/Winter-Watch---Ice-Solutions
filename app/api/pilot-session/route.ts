import { SYNTHETIC_AUDIENCE, SYNTHETIC_ISSUER, loadAccessConfig, readRuntimeEnv, signAccessJwt } from "../../../lib/access-auth";

export async function POST(request: Request) {
  const env = readRuntimeEnv();
  const loaded = loadAccessConfig(env);
  if (!loaded.ok || !loaded.config.synthetic) {
    return Response.json({ error: "not_found", message: "Local synthetic sign-in is disabled." }, { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const form = await request.formData().catch(() => null);
  const role = String(form?.get("role") ?? "operator");
  const privateJwk = env.PILOT_SYNTHETIC_PRIVATE_JWK ? JSON.parse(env.PILOT_SYNTHETIC_PRIVATE_JWK) as JsonWebKey : null;
  if (!privateJwk) {
    return Response.json({ error: "configuration_required", message: "The local synthetic signing key is not configured." }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
  const email = role === "admin" ? "admin@synthetic.winter-watch.invalid" : "operator@synthetic.winter-watch.invalid";
  const now = Math.floor(Date.now() / 1000);
  const token = await signAccessJwt(privateJwk, {
    sub: role === "admin" ? "synthetic-admin" : "synthetic-operator",
    email,
    aud: SYNTHETIC_AUDIENCE,
    iss: SYNTHETIC_ISSUER,
    iat: now,
    nbf: now,
    exp: now + 8 * 3600,
    groups: role === "admin" ? ["winter-watch-admins"] : [],
  });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": `CF_Authorization=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`,
      "cache-control": "private, no-store",
    },
  });
}
