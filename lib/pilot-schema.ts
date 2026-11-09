import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./sql.ts";

const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "../db/0001_pilot.sql");

export async function ensurePilotSchema(db: Sql): Promise<void> {
  await db.exec(readFileSync(sqlPath, "utf8"));
}
