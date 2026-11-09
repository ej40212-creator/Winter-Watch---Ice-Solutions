import { authenticate, loadAccessConfig, readRuntimeEnv, type AccessIdentity, type EnvBag } from "./access-auth.ts";
import { consumeIdentityRate, providerDecision, rateLimitPerMinute } from "./provider-policy.ts";
import { tokenFromRequest } from "./request-guard.ts";
import { allowsWrite } from "./same-origin.ts";
import { syntheticDataAllowed } from "./synthetic-gate.ts";

const PRIVATE = { "cache-control": "private, no-store" };

export function devBuildFlag(): boolean {
  return import.meta.env?.DEV === true;
}

export async function accessIdentity(request: Request, env: EnvBag = readRuntimeEnv(), now = Date.now()): Promise<{ identity: AccessIdentity; env: EnvBag } | Response> {
  const loaded = loadAccessConfig(env, { devBuild: devBuildFlag() });
  if (!loaded.ok) return Response.json({ error: loaded.error, message: loaded.message }, { status: loaded.status, headers: PRIVATE });
  const decision = await authenticate(tokenFromRequest(request), loaded.config, now);
  if (!decision.ok) return Response.json({ error: decision.error, message: decision.message }, { status: decision.status, headers: PRIVATE });
  const limit = rateLimitPerMinute(env);
  const rate = consumeIdentityRate(decision.identity.sub || decision.identity.email, now, limit.limit);
  if (!rate.allowed) {
    return Response.json({ error: "rate_limited", message: "This identity exceeded the per-minute request limit.", policy: limit.policy }, { status: 429, headers: { ...PRIVATE, "x-rate-limit-policy": limit.policy } });
  }
  return { identity: decision.identity, env };
}

export async function requireAdmin(request: Request, env?: EnvBag): Promise<{ identity: AccessIdentity; env: EnvBag } | Response> {
  if (!allowsWrite(request) && request.method !== "GET") {
    return Response.json({ error: "forbidden", message: "The request origin is not accepted." }, { status: 403, headers: PRIVATE });
  }
  const result = await accessIdentity(request, env);
  if (result instanceof Response) return result;
  if (!result.identity.admin) {
    return Response.json({ error: "forbidden", message: "This identity is not allowed to call admin, MCP, or refresh endpoints." }, { status: 403, headers: PRIVATE });
  }
  return result;
}

export function liveProvider(env: EnvBag) {
  return providerDecision(env);
}

export function syntheticForRequest(request: Request, env: EnvBag): boolean {
  const host = new URL(request.url).hostname;
  return syntheticDataAllowed({ devBuild: devBuildFlag(), host, authFlag: env.PILOT_SYNTHETIC_AUTH, dataFlag: env.PILOT_SYNTHETIC_DATA });
}

export const NOT_RUN = {
  execution: "not_run" as const,
  error: "Live provider refresh is not authorized, or PROVIDER_BUDGET is unset. No provider call was made.",
};

export async function prepareRead(request: Request): Promise<{ allowLive: boolean; synthetic: boolean; env: EnvBag } | Response> {
  const env = readRuntimeEnv();
  const access = await accessIdentity(request, env);
  if (access instanceof Response) return access;
  return { allowLive: liveProvider(env).allowLive, synthetic: syntheticForRequest(request, env), env };
}
