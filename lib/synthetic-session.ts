import { SYNTHETIC_AUDIENCE, SYNTHETIC_ISSUER, signAccessJwt } from "./access-auth.ts";
import { isLoopbackHost } from "./loopback.ts";

/** Dev-only mint. Production builds must not import this module. */
export async function mintSyntheticSession(request: Request, env: { PILOT_SYNTHETIC_PRIVATE_JWK?: string; ADMIN_GROUPS?: string }): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname)) {
    return Response.json({ error: "not_found", message: "Synthetic sign-in is loopback-only." }, { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const form = await request.formData().catch(() => null);
  const role = String(form?.get("role") ?? "operator");
  if (role !== "operator" && role !== "admin") {
    return Response.json({ error: "invalid_role", message: "Synthetic role must be operator or admin." }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }
  const privateJwk = env.PILOT_SYNTHETIC_PRIVATE_JWK ? JSON.parse(env.PILOT_SYNTHETIC_PRIVATE_JWK) as JsonWebKey & { kid?: string } : null;
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
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": `CF_Authorization=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`,
      "cache-control": "private, no-store",
    },
  });
}
