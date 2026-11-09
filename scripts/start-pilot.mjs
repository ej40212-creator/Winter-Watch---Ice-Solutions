import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
publicJwk.kid = privateJwk.kid = "synthetic-local";
publicJwk.alg = privateJwk.alg = "RS256";
const auth = { publicJwk, privateJwk };
mkdirSync("/tmp/ww-evidence", { recursive: true });
writeFileSync("/tmp/ww-evidence/synthetic-auth.json", JSON.stringify(auth));
const env = {
  ...process.env,
  PILOT_SYNTHETIC_AUTH: "1",
  PILOT_SYNTHETIC_DATA: "1",
  ACCESS_AUD: "synthetic-pilot",
  ACCESS_ISSUER: "https://synthetic.winter-watch.invalid",
  ACCESS_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
  PILOT_SYNTHETIC_PRIVATE_JWK: JSON.stringify(privateJwk),
  ADMIN_EMAILS: "admin@synthetic.winter-watch.invalid",
  ADMIN_GROUPS: "winter-watch-admins",
  SCHEDULER_ENABLED: "",
  PROVIDER_REFRESH: "",
};
const child = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", "5173"], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
