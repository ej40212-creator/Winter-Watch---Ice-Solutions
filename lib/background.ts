import { env } from "cloudflare:workers";
import sites from "./sites-data";
import { cached, forecast, save, snapshot } from "./weather";
import { runBoundedCycle } from "./scheduler";
import { wrapD1 } from "./sql-d1";

const NOT_AUTHORIZED = {
  status: "not_authorized",
  execution: "not_run",
  busy: false,
  completed: 0,
  remainingDue: null,
  message: "Live provider refresh is not authorized. No sites were fetched. Refresh cadence and provider budget are unset deployment decisions.",
};

export async function refreshBatch() {
  if ((env as { PROVIDER_REFRESH?: string }).PROVIDER_REFRESH !== "authorized") return NOT_AUTHORIZED;
  const database = (env as { DB?: D1Database }).DB;
  if (!database) {
    return { status: "configuration_required", execution: "not_run", busy: false, message: "D1 binding DB is not configured. No provider refresh ran." };
  }
  const sql = wrapD1(database);
  let cycle;
  try {
  cycle = await runBoundedCycle(sql, {
    now: Date.now(),
    siteIds: sites.filter((site) => site.state !== "DC").map((site) => site.key),
    execution: "provider",
    refreshSite: async (siteId) => {
      try {
        const result = await forecast(siteId);
        const ok = result.status === "ok" || result.status === "stale";
        return { ok, error: ok ? undefined : result.error || result.status };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Provider refresh failed." };
      }
    },
  });
  } catch {
    return { status: "configuration_required", execution: "not_run", busy: false, message: "D1 pilot refresh tables are not available. No fleet refresh was completed." };
  }
  const status = {
    status: cycle.status,
    execution: "provider",
    lastRun: cycle.finishedAt,
    completed: cycle.processed,
    remainingDue: cycle.remainingDue,
    totalSites: sites.filter((site) => site.state !== "DC").length,
    ok: cycle.ok,
    failed: cycle.failed,
    failures: cycle.failures,
    busy: cycle.busy,
  };
  await save("background-status", status, 365 * 86400000);
  return status;
}

export async function refreshStatus() {
  const all = await snapshot();
  const background = await cached("background-status", false);
  return {
    background,
    checked: all.length,
    totalSites: sites.filter((site) => site.state !== "DC").length,
    addressReview: all.filter((row: { failureKind?: string; error?: string; key: string }) => row.failureKind === "address" || /Address/.test(row.error || "")).map((row: { key: string; error?: string }) => ({ key: row.key, ...sites.find((site) => site.key === row.key), error: row.error })),
    temporaryFailures: all.filter((row: { status?: string; failureKind?: string }) => row.status === "error" && row.failureKind !== "address").length,
    scheduler: "No unattended cadence is configured. A completed batch above is an actual provider execution only when execution is provider.",
  };
}
