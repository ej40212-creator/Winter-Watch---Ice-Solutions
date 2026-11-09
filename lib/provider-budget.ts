import type { Sql } from "./sql.ts";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Atomic per-hour counter. The UPDATE runs only while spent is below the budget,
 * so two callers cannot both pass the last remaining unit.
 * The budget value itself stays a deployment setting and has no default.
 */
export async function consumeProviderCall(db: Sql, now: number, budget: number): Promise<boolean> {
  if (!Number.isInteger(budget) || budget <= 0) return false;
  const period = now - (now % HOUR_MS);
  const row = await db.get<{ spent: number }>(
    `INSERT INTO provider_budget(period_start, spent) VALUES (?, 1)
     ON CONFLICT(period_start) DO UPDATE SET spent = spent + 1
     WHERE provider_budget.spent < ?
     RETURNING spent`,
    period,
    budget,
  );
  return !!row;
}

/** Durable per-identity window. Old windows are deleted so the table does not grow without bound. */
export async function consumeDurableRate(db: Sql, identity: string, now: number, limit: number): Promise<boolean> {
  const windowStart = now - (now % 60_000);
  await db.run("DELETE FROM identity_rate WHERE window_start < ?", windowStart - 120_000);
  const row = await db.get<{ count: number }>(
    `INSERT INTO identity_rate(identity, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(identity, window_start) DO UPDATE SET count = count + 1
     WHERE identity_rate.count < ?
     RETURNING count`,
    identity,
    windowStart,
    limit,
  );
  return !!row;
}
