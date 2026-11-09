import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const banned = ["PILOT_SYNTHETIC_AUTH", "PILOT_SYNTHETIC_DATA", "PILOT_SYNTHETIC_PRIVATE_JWK", "BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY"];

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files(path, acc);
    else if (/wrangler.*\.jsonc?$/.test(name) || name.endsWith(".json")) acc.push(path);
  }
  return acc;
}

const roots = ["dist"].filter((dir) => {
  try { return statSync(dir).isDirectory(); } catch { return false; }
});
if (!roots.length) {
  console.error("No dist directory. Run the production build before this check.");
  process.exit(1);
}
const found = [];
for (const file of files("dist")) {
  if (!/wrangler|\.openai|hosting/i.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const token of banned) if (text.includes(token)) found.push(`${file}: ${token}`);
  if (/wrangler/i.test(file) && /"workers_dev"\s*:\s*true/.test(text)) found.push(`${file}: workers_dev true`);
}
if (found.length) {
  console.error(found.join("\n"));
  process.exit(1);
}
console.log("Build config does not contain synthetic auth, a private key, or workers_dev true.");
