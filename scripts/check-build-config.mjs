import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const bannedConfig = ["PILOT_SYNTHETIC_AUTH", "PILOT_SYNTHETIC_DATA", "PILOT_SYNTHETIC_PRIVATE_JWK", "BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY"];
const bannedJs = ["PILOT_SYNTHETIC", "ACCESS_JWKS_JSON", "mintSyntheticSession", "\"d\":\""];
const jwtLike = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

if (!statSync("dist", { throwIfNoEntry: false })) {
  console.error("No dist directory. Run the production build before this check.");
  process.exit(1);
}
const found = [];
let sawWorkersDevFalse = false;
for (const file of walk("dist")) {
  const text = readFileSync(file, "utf8");
  if (/wrangler.*\.jsonc?$/.test(file) || /hosting\.json$/.test(file)) {
    for (const token of bannedConfig) if (text.includes(token)) found.push(`${file}: ${token}`);
    if (/"workers_dev"\s*:\s*false/.test(text)) sawWorkersDevFalse = true;
    if (/"workers_dev"\s*:\s*true/.test(text)) found.push(`${file}: workers_dev true`);
  }
  if (/\.(m?js)$/.test(file)) {
    for (const token of bannedJs) if (text.includes(token)) found.push(`${file}: ${token}`);
    if (jwtLike.test(text)) found.push(`${file}: jwt-looking string`);
  }
}
if (!sawWorkersDevFalse) found.push("workers_dev is not explicitly false in the built config");
if (found.length) {
  console.error(found.join("\n"));
  process.exit(1);
}
console.log("Build config and JS bundle do not contain synthetic auth, a private JWK, or an enabled workers.dev publish.");
