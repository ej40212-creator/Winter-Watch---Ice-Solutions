import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { wrapNodeSqlite } from "../lib/sql.ts";
import { rowsFromContract } from "../lib/site-identity.ts";
import { importSiteBatch, openReviewCounts } from "../lib/site-import.ts";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const out = args.get("--out");
const jsonPath = args.get("--json");
const xlsxPath = args.get("--xlsx");
if (!out || (!jsonPath && !xlsxPath)) {
  console.error("Usage: node --experimental-strip-types scripts/import-sites.mjs --out file.sqlite (--json contract.json | --xlsx workbook.xlsx)");
  process.exit(1);
}
if (/\/(public|lib|app|fixtures)\//.test(out)) {
  console.error("Refusing to write the import database into client or public paths.");
  process.exit(1);
}
let records;
let filename;
let fileSha;
if (xlsxPath) {
  const read = spawnSync("python3", ["scripts/read-xlsx-rows.py", xlsxPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (read.status !== 0) throw new Error(read.stderr || "xlsx reader failed");
  records = JSON.parse(read.stdout);
  filename = xlsxPath.split("/").at(-1);
  fileSha = createHash("sha256").update(readFileSync(xlsxPath)).digest("hex");
} else {
  const bytes = readFileSync(jsonPath);
  records = JSON.parse(bytes.toString("utf8"));
  filename = jsonPath.split("/").at(-1);
  fileSha = createHash("sha256").update(bytes).digest("hex");
}
const db = wrapNodeSqlite(new DatabaseSync(out));
const summary = await importSiteBatch(db, { rows: rowsFromContract(records), sha256: fileSha, filename, actor: args.get("--actor") || "cli" });
const counts = await openReviewCounts(db);
console.log(JSON.stringify({ summary, openReviews: counts }, null, 2));
