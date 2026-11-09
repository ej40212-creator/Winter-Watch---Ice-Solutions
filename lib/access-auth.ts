export const SYNTHETIC_ISSUER = "https://synthetic.winter-watch.invalid";
export const SYNTHETIC_AUDIENCE = "synthetic-pilot";

export type EnvBag = Record<string, string | undefined>;

export type AccessConfig = {
  audience: string;
  issuer: string;
  jwks: { keys: JsonWebKey[] };
  jwksUrl: string | null;
  adminEmails: string[];
  adminGroups: string[];
  synthetic: boolean;
  adminPolicyConfigured: boolean;
};

export type AccessIdentity = {
  sub: string;
  email: string;
  groups: string[];
  admin: boolean;
};

export type AccessDecision =
  | { ok: true; identity: AccessIdentity }
  | { ok: false; status: 401 | 403 | 503; error: string; message: string };

const ENV_KEYS = [
  "ACCESS_AUD",
  "ACCESS_ISSUER",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_JWKS_JSON",
  "ACCESS_JWKS_URL",
  "ADMIN_EMAILS",
  "ADMIN_GROUPS",
  "PILOT_SYNTHETIC_AUTH",
  "PILOT_SYNTHETIC_PRIVATE_JWK",
  "PILOT_SYNTHETIC_DATA",
  "SCHEDULER_ENABLED",
  "PROVIDER_REFRESH",
  "ACCUWEATHER_RIGHTS_CONFIRMED",
] as const;

export function readRuntimeEnv(workerEnv?: object): EnvBag {
  const bag: EnvBag = {};
  for (const key of ENV_KEYS) {
    let value = "";
    if (workerEnv && key in workerEnv) {
      const fromWorker = (workerEnv as Record<string, unknown>)[key];
      if (typeof fromWorker === "string") value = fromWorker;
    }
    if (!value && typeof process !== "undefined" && typeof process.env[key] === "string") value = process.env[key] ?? "";
    if (value) bag[key] = value;
  }
  return bag;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export type ConfigResult = { ok: true; config: AccessConfig } | { ok: false; status: 503; error: string; message: string };

type SigningJwk = JsonWebKey & { kid?: string; alg?: string };

function bytesAsBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function loadAccessConfig(env: EnvBag, options?: { devBuild?: boolean }): ConfigResult {
  const synthetic = env.PILOT_SYNTHETIC_AUTH === "1" && options?.devBuild === true;
  const audience = env.ACCESS_AUD || (synthetic ? SYNTHETIC_AUDIENCE : "");
  const issuer = env.ACCESS_ISSUER || (env.ACCESS_TEAM_DOMAIN ? `https://${env.ACCESS_TEAM_DOMAIN}` : synthetic ? SYNTHETIC_ISSUER : "");
  if (synthetic && (issuer !== SYNTHETIC_ISSUER || audience !== SYNTHETIC_AUDIENCE)) {
    return {
      ok: false,
      status: 503,
      error: "configuration_required",
      message: "Synthetic local auth cannot use a real Cloudflare Access issuer or audience. The pilot stays closed.",
    };
  }
  if (!audience || !issuer) {
    return {
      ok: false,
      status: 503,
      error: "configuration_required",
      message: "Cloudflare Access audience and issuer are not configured. Unsigned identity headers are ignored.",
    };
  }
  const jwksUrl = env.ACCESS_JWKS_URL || (!synthetic && env.ACCESS_TEAM_DOMAIN ? `${issuer}/cdn-cgi/access/certs` : null);
  const staticJsonAllowed = synthetic || !jwksUrl;
  let jwks: { keys: JsonWebKey[] } = { keys: [] };
  if (env.ACCESS_JWKS_JSON && staticJsonAllowed) {
    try {
      const parsed = JSON.parse(env.ACCESS_JWKS_JSON) as { keys?: JsonWebKey[] };
      if (!parsed || !Array.isArray(parsed.keys)) throw new Error("JWKS keys missing");
      jwks = { keys: parsed.keys };
    } catch {
      return { ok: false, status: 503, error: "configuration_required", message: "ACCESS_JWKS_JSON is not a JWKS document. Access stays closed." };
    }
  }
  if (!jwks.keys.length && !jwksUrl) {
    return {
      ok: false,
      status: 503,
      error: "configuration_required",
      message: "No Access signing keys are configured. The pilot does not accept unverified tokens.",
    };
  }
  const adminEmails = splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase());
  const adminGroups = splitList(env.ADMIN_GROUPS);
  return {
    ok: true,
    config: {
      audience,
      issuer,
      jwks,
      jwksUrl,
      adminEmails,
      adminGroups,
      synthetic,
      adminPolicyConfigured: adminEmails.length + adminGroups.length > 0,
    },
  };
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
}

const JWKS_TTL_MS = 10 * 60 * 1000;
const jwksCache = new Map<string, { keys: SigningJwk[]; expires: number }>();

export function resetJwksCache(): void {
  jwksCache.clear();
}

function usableKey(key: SigningJwk): boolean {
  return key.kty === "RSA" && !!key.kid && (!key.use || key.use === "sig");
}

async function fetchJwks(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<SigningJwk[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { keys?: SigningJwk[] };
    if (!body || !Array.isArray(body.keys)) return null;
    return body.keys.filter(usableKey);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function remoteKeys(config: AccessConfig, fetchImpl: typeof fetch, now: number, force: boolean): Promise<SigningJwk[] | null> {
  if (!config.jwksUrl) return null;
  const cached = jwksCache.get(config.jwksUrl);
  if (!force && cached && cached.expires > now) return cached.keys;
  const keys = await fetchJwks(config.jwksUrl, fetchImpl, 5000);
  if (!keys) return cached?.keys ?? null;
  jwksCache.set(config.jwksUrl, { keys, expires: now + JWKS_TTL_MS });
  return keys;
}

async function jwkFor(header: { kid?: string; alg?: string }, config: AccessConfig, fetchImpl: typeof fetch, now: number): Promise<SigningJwk | null> {
  if (header.alg !== "RS256" || !header.kid) return null;
  const staticKeys = (config.jwksUrl && !config.synthetic ? [] : config.jwks.keys).filter(usableKey) as SigningJwk[];
  const staticMatch = staticKeys.find((key) => key.kid === header.kid);
  if (staticMatch && !config.jwksUrl) return staticMatch;
  if (!config.jwksUrl) return null;
  const first = await remoteKeys(config, fetchImpl, now, false);
  const found = first?.find((key) => key.kid === header.kid);
  if (found) return found;
  const second = await remoteKeys(config, fetchImpl, now, true);
  return second?.find((key) => key.kid === header.kid) ?? null;
}

export async function signAccessJwt(privateJwk: SigningJwk, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: privateJwk.kid };
  const encoded = `${bytesToB64url(new TextEncoder().encode(JSON.stringify(header)))}.${bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(encoded));
  return `${encoded}.${bytesToB64url(new Uint8Array(signature))}`;
}

export async function authenticate(
  token: string | null,
  config: AccessConfig,
  now = Date.now(),
  fetchJwks: typeof fetch = fetch,
): Promise<AccessDecision> {
  if (!token) {
    return { ok: false, status: 401, error: "unauthorized", message: "A valid Cloudflare Access token is required." };
  }
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401, error: "unauthorized", message: "The access token is not a signed JWT." };
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(parts[0]!) as { alg?: string; kid?: string };
    payload = decodeJson(parts[1]!) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token could not be read." };
  }
  if (header.alg === "none" || header.alg !== "RS256") {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token algorithm is not accepted." };
  }
  const jwk = await jwkFor(header, config, fetchJwks, now);
  if (!jwk) return { ok: false, status: 401, error: "unauthorized", message: "The access token signing key is not trusted." };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytesAsBuffer(b64urlToBytes(parts[2]!)),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return { ok: false, status: 401, error: "unauthorized", message: "The access token signature is invalid." };
  const skew = 60;
  const exp = payload.exp;
  const nbf = payload.nbf;
  const nowSeconds = now / 1000;
  if (typeof exp !== "number" || nowSeconds > exp + skew) {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token is expired." };
  }
  if (typeof nbf === "number" && nowSeconds + skew < nbf) {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token is not valid yet." };
  }
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.audience)) {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token audience does not match this pilot." };
  }
  if (payload.iss !== config.issuer) {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token issuer does not match this pilot." };
  }
  const email = typeof payload.email === "string" ? payload.email : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!email || !sub) return { ok: false, status: 401, error: "unauthorized", message: "The access token is missing a subject or email." };
  const groups = [
    ...(Array.isArray(payload.groups) ? payload.groups : []),
    ...(payload.custom && typeof payload.custom === "object" && Array.isArray((payload.custom as { groups?: unknown }).groups)
      ? ((payload.custom as { groups: unknown[] }).groups)
      : []),
  ].filter((group): group is string => typeof group === "string");
  const admin = config.adminEmails.includes(email.toLowerCase()) || groups.some((group) => config.adminGroups.includes(group));
  return { ok: true, identity: { sub, email, groups, admin } };
}
