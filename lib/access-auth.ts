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
  "ACCESS_JWKS_URL",
  "ADMIN_EMAILS",
  "ADMIN_GROUPS",
  "SCHEDULER_ENABLED",
  "PROVIDER_REFRESH",
  "PROVIDER_BUDGET",
  "OPERATOR_RATE_LIMIT_PER_MINUTE",
  "REFRESH_DUE_AFTER_MS",
  "ACCUWEATHER_RIGHTS_CONFIRMED",
  "PILOT_PUBLIC_ORIGIN",
] as const;

function copyEnv(bag: EnvBag, key: string, workerEnv?: object): void {
  let value = "";
  if (workerEnv && key in workerEnv) {
    const fromWorker = (workerEnv as Record<string, unknown>)[key];
    if (typeof fromWorker === "string") value = fromWorker;
  }
  if (!value && typeof process !== "undefined" && typeof process.env[key] === "string") value = process.env[key] ?? "";
  if (value) bag[key] = value;
}

export function readRuntimeEnv(workerEnv?: object): EnvBag {
  const bag: EnvBag = {};
  for (const key of ENV_KEYS) copyEnv(bag, key, workerEnv);
  // These names exist only in a dev build. A production bundle drops the branch, so the strings are not shipped.
  if (import.meta.env?.DEV === true) {
    for (const key of ["ACCESS_JWKS_JSON", "PILOT_SYNTHETIC_AUTH", "PILOT_SYNTHETIC_DATA", "PILOT_SYNTHETIC_PRIVATE_JWK"]) {
      copyEnv(bag, key, workerEnv);
    }
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

export function loadAccessConfig(env: EnvBag, options?: { devBuild?: boolean; staticJwks?: { keys: JsonWebKey[] } }): ConfigResult {
  let synthetic = false;
  if (import.meta.env?.DEV === true && options?.devBuild === true && env.PILOT_SYNTHETIC_AUTH === "1") synthetic = true;
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
  let jwks: { keys: JsonWebKey[] } = options?.staticJwks ?? { keys: [] };
  if (!options?.staticJwks && import.meta.env?.DEV === true && staticJsonAllowed && env.ACCESS_JWKS_JSON) {
    try {
      const parsed = JSON.parse(env.ACCESS_JWKS_JSON) as { keys?: JsonWebKey[] };
      if (!parsed || !Array.isArray(parsed.keys)) throw new Error("JWKS keys missing");
      jwks = { keys: parsed.keys };
    } catch {
      return { ok: false, status: 503, error: "configuration_required", message: "The local signing-key document is invalid. Access stays closed." };
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
const STALE_GRACE_MS = 60_000;
const UNKNOWN_REFETCH_MS = 60_000;
const jwksCache = new Map<string, { keys: SigningJwk[]; expires: number }>();
const unknownRefetchAt = new Map<string, number>();
const inflightFetches = new Map<string, Promise<SigningJwk[] | null>>();

export function resetJwksCache(): void {
  jwksCache.clear();
  unknownRefetchAt.clear();
  inflightFetches.clear();
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

type KeyLookup = { ok: true; key: SigningJwk } | { ok: false; status: 401 | 503; message: string };

async function loadRemoteKeys(url: string, fetchImpl: typeof fetch, now: number, forceUnknown: boolean): Promise<{ keys: SigningJwk[] | null; failed: boolean }> {
  const cached = jwksCache.get(url);
  if (!forceUnknown && cached && cached.expires > now) return { keys: cached.keys, failed: false };
  if (forceUnknown) {
    const last = unknownRefetchAt.get(url) ?? 0;
    if (now - last < UNKNOWN_REFETCH_MS) return { keys: cached?.keys ?? null, failed: false };
    unknownRefetchAt.set(url, now);
  }
  let pending = inflightFetches.get(url);
  if (!pending) {
    pending = fetchJwks(url, fetchImpl, 5000);
    inflightFetches.set(url, pending);
    void pending.finally(() => inflightFetches.delete(url));
  }
  const keys = await pending;
  if (!keys) {
    if (cached && now <= cached.expires + STALE_GRACE_MS) return { keys: cached.keys, failed: true };
    return { keys: null, failed: true };
  }
  jwksCache.set(url, { keys, expires: now + JWKS_TTL_MS });
  return { keys, failed: false };
}

async function jwkFor(header: { kid?: string; alg?: string }, config: AccessConfig, fetchImpl: typeof fetch, now: number): Promise<KeyLookup> {
  if (header.alg !== "RS256" || !header.kid) return { ok: false, status: 401, message: "The access token is missing a trusted key id." };
  const staticKeys = (config.jwksUrl && !config.synthetic ? [] : config.jwks.keys).filter(usableKey) as SigningJwk[];
  const staticMatch = staticKeys.find((key) => key.kid === header.kid);
  if (staticMatch && !config.jwksUrl) return { ok: true, key: staticMatch };
  if (!config.jwksUrl) return { ok: false, status: 401, message: "The access token signing key is not trusted." };
  const first = await loadRemoteKeys(config.jwksUrl, fetchImpl, now, false);
  if (first.failed && !first.keys) return { ok: false, status: 503, message: "The Access signing keys could not be fetched. Access stays closed." };
  if (first.keys?.some((key) => key.kid === header.kid)) return { ok: true, key: first.keys.find((key) => key.kid === header.kid)! };
  const second = await loadRemoteKeys(config.jwksUrl, fetchImpl, now, true);
  if (second.failed && !second.keys) return { ok: false, status: 503, message: "The Access signing keys could not be fetched. Access stays closed." };
  const match = second.keys?.find((key) => key.kid === header.kid);
  if (!match) return { ok: false, status: 401, message: "The access token key id is not in the trusted set." };
  return { ok: true, key: match };
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
  const found = await jwkFor(header, config, fetchJwks, now);
  if (!found.ok) return { ok: false, status: found.status, error: found.status === 503 ? "configuration_required" : "unauthorized", message: found.message };
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", found.key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch {
    return { ok: false, status: 401, error: "unauthorized", message: "The access token signing key could not be used." };
  }
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
