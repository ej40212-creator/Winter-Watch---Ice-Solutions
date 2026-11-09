import { authenticate, loadAccessConfig, readRuntimeEnv, type EnvBag } from "./access-auth.ts";

const PUBLIC_PATHS = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/ice-solutions-logo.png",
  "/winter-watch-share-v1.png",
  "/file.svg",
  "/globe.svg",
  "/window.svg",
]);

export function isPublicAsset(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/static/") || pathname.startsWith("/assets/");
}

export function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/api/refresh" ||
    pathname.startsWith("/api/refresh/") ||
    pathname === "/api/performance" ||
    pathname.startsWith("/api/performance/") ||
    pathname.startsWith("/api/admin")
  );
}

export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization") return decodeURIComponent(rest.join("="));
  }
  return null;
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") || request.headers.get("sec-fetch-dest") === "document";
}

function page(status: number, error: string, message: string, synthetic: boolean): Response {
  const form = synthetic
    ? `<form method="post" action="/api/pilot-session"><p>Local synthetic identity only. This is not Cloudflare Access and it is disabled unless the synthetic issuer is explicitly configured.</p><button name="role" value="operator" type="submit">Continue as synthetic operator</button><button name="role" value="admin" type="submit">Continue as synthetic admin</button></form>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Winter Watch private pilot</title><style>body{font-family:sans-serif;margin:40px;line-height:1.5;color:#152d3e}button{min-height:44px;margin-right:8px}</style></head><body><p>Private pilot</p><h1>${error === "configuration_required" ? "Configuration required" : error === "forbidden" ? "Not allowed" : "Sign-in required"}</h1><p>${message}</p>${form}</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}

export function authResponse(request: Request, status: number, error: string, message: string, synthetic = false): Response {
  if (wantsHtml(request) && !new URL(request.url).pathname.startsWith("/api/") && new URL(request.url).pathname !== "/mcp") {
    return page(status, error, message, synthetic);
  }
  return Response.json({ error, message }, { status, headers: { "cache-control": "private, no-store" } });
}

export async function guardRequest(request: Request, env: EnvBag, now = Date.now()): Promise<Response | null> {
  const url = new URL(request.url);
  if (isPublicAsset(url.pathname)) return null;
  const loaded = loadAccessConfig(env);
  if (url.pathname === "/api/pilot-session") {
    if (!loaded.ok || !loaded.config.synthetic) {
      return authResponse(request, 404, "not_found", "Local synthetic sign-in is disabled.");
    }
    return null;
  }
  if (!loaded.ok) return authResponse(request, loaded.status, loaded.error, loaded.message);
  const token = tokenFromRequest(request);
  const decision = await authenticate(token, loaded.config, now);
  if (!decision.ok) return authResponse(request, decision.status, decision.error, decision.message, loaded.config.synthetic);
  if (isAdminPath(url.pathname) && !decision.identity.admin) {
    const message = loaded.config.adminPolicyConfigured
      ? "This identity is not allowed to call admin, MCP, or refresh endpoints."
      : "Admin policy is not configured. Admin, MCP, and refresh endpoints stay closed.";
    return authResponse(request, 403, "forbidden", message);
  }
  return null;
}

export function envForRequest(workerEnv?: object): EnvBag {
  return readRuntimeEnv(workerEnv);
}
