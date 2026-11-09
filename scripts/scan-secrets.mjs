import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const blockedName = /\.(xlsx|csv|sqlite)$/i;
const provisional = /(^|\/)provisional.*\.json$/i;
const badNames = tracked.filter((file) => blockedName.test(file) || provisional.test(file));
const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /PILOT_SYNTHETIC_PRIVATE_JWK"\s*:\s*"\{/, /AKIA[0-9A-Z]{16}/, /\b\d{1,6}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct)\b/];
const hits = [];
for (const file of tracked) {
  if (file.endsWith(".png") || file.startsWith("fixtures/") || file.startsWith("scripts/test-")) continue;
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of patterns) if (pattern.test(text)) hits.push(`${file} matches ${pattern}`);
}
if (badNames.length || hits.length) {
  console.error([...badNames, ...hits].join("\n"));
  process.exit(1);
}
console.log(`Scanned ${tracked.length} tracked files. No workbook, sqlite, provisional inventory, or private-key material.`);
