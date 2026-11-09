import { readFileSync } from "node:fs";
import { reviewedSeedStatements } from "../lib/seed-from-import.ts";

const index = process.argv.indexOf("--json");
const path = index >= 0 ? process.argv[index + 1] : "";
if (!path) {
  console.error("Usage: node --experimental-strip-types scripts/d1-seed-sql.mjs --json reviewed.json");
  process.exit(1);
}
const sites = JSON.parse(readFileSync(path, "utf8"));
const now = new Date().toISOString();
const payload = await reviewedSeedStatements(sites, now, "seed-script");
process.stdout.write(`${JSON.stringify(payload)}\n`);
