import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding DB is not configured. The private pilot cannot read or write data until that binding exists."
    );
  }

  return drizzle(env.DB, { schema });
}
