/** A queue load can request current conditions for every site in a 40-site batch. */
export const SAFETY_RATE_LIMIT_PER_MINUTE = 150;

export type ProviderDecision = {
  allowLive: boolean;
  budget: number | null;
  reason: "authorized" | "refresh_not_authorized" | "budget_unset";
};

/** Live provider calls require both an explicit authorization and a positive budget. The budget has no default. */
export function providerDecision(env: { PROVIDER_REFRESH?: string; PROVIDER_BUDGET?: string }): ProviderDecision {
  if (env.PROVIDER_REFRESH !== "authorized") {
    return { allowLive: false, budget: null, reason: "refresh_not_authorized" };
  }
  const budget = Number(env.PROVIDER_BUDGET);
  if (!env.PROVIDER_BUDGET || !Number.isInteger(budget) || budget <= 0) {
    return { allowLive: false, budget: null, reason: "budget_unset" };
  }
  return { allowLive: true, budget, reason: "authorized" };
}

export function rateLimitPerMinute(env: { OPERATOR_RATE_LIMIT_PER_MINUTE?: string }): { limit: number; policy: "configured" | "safety-ceiling" } {
  const parsed = Number(env.OPERATOR_RATE_LIMIT_PER_MINUTE);
  if (env.OPERATOR_RATE_LIMIT_PER_MINUTE && Number.isInteger(parsed) && parsed > 0) return { limit: parsed, policy: "configured" };
  return { limit: SAFETY_RATE_LIMIT_PER_MINUTE, policy: "safety-ceiling" };
}

const buckets = new Map<string, { windowStart: number; count: number }>();

/**
 * Per-isolate fallback used only when D1 is not bound.
 * Live provider calls do not use this map; they require the D1 budget counter.
 * Cache-read limiting is per isolate in that fallback because there is no shared store.
 * Entries older than two minutes are removed on each call.
 */
export function consumeIdentityRate(identity: string, now: number, limit: number, store = buckets): { allowed: boolean; remaining: number } {
  const cutoff = now - 120_000;
  for (const [key, value] of store) if (value.windowStart < cutoff) store.delete(key);
  const windowStart = now - (now % 60_000);
  const key = `${identity}|${windowStart}`;
  const current = store.get(key) ?? { windowStart, count: 0 };
  if (current.count >= limit) return { allowed: false, remaining: 0 };
  current.count += 1;
  store.set(key, current);
  return { allowed: true, remaining: limit - current.count };
}

export function resetIdentityRates(store = buckets): void {
  store.clear();
}
