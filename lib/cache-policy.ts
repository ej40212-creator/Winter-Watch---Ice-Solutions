import { retryDelay } from "./coverage.ts";
import { summarize } from "./risk.ts";

export function providerFailureMessage(input: { status?: number; aborted?: boolean }): string {
  if (input.aborted) return "Weather provider timed out.";
  if (input.status === 429) return "Weather provider rate limit; automatic retry scheduled.";
  return `Weather provider temporarily unavailable (${input.status ?? "unknown"}).`;
}

export function gridCacheKey(gridUrl: string): string {
  return `grid-forecast-v1:${gridUrl}`;
}

export function pointAlertCacheKey(lat: number, lon: number): string {
  return `point-alerts-v1:${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function planForecastFetches(forecastHourly: string, lat: number, lon: number) {
  return {
    gridKey: gridCacheKey(forecastHourly),
    alertKey: pointAlertCacheKey(lat, lon),
    alertUrl: `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
  };
}

export function acceptGridForecast(key: string, body: unknown): { key: string; body: unknown } {
  if (!sharedCacheAllows(key, body)) throw new Error("Refusing to store point-specific alerts in a shared grid cache.");
  return { key, body };
}

export function outlookCacheKey(siteId: string): string {
  return `outlook-v3:${siteId}`;
}

export function isSharedGridKey(key: string): boolean {
  return key.startsWith("grid-forecast-v1:");
}

/** Shared grid entries hold the forecast document only. Point alerts belong on the point key and the site outlook. */
export function sharedCacheAllows(key: string, value: unknown): boolean {
  if (!isSharedGridKey(key) || !value || typeof value !== "object") return true;
  const record = value as { features?: unknown; alerts?: unknown; properties?: { alerts?: unknown; features?: unknown } };
  if (Array.isArray(record.features) || Array.isArray(record.alerts)) return false;
  if (record.properties && (Array.isArray(record.properties.alerts) || Array.isArray(record.properties.features))) return false;
  return true;
}

export function buildOutlookRecord(input: {
  siteKey: string;
  grid: string | null;
  alertPoint: string | null;
  periods: any[];
  pointAlerts: any[];
  issued: string | null;
  weatherOk: boolean;
  alertsOk: boolean;
  now: number;
  sourceAddress?: string;
  loc?: Record<string, unknown>;
  priorFailures?: number;
}) {
  const pointAlerts = [...input.pointAlerts];
  const summary = summarize(input.periods, pointAlerts, input.now, 168);
  const oldForecast = !input.issued || !Number.isFinite(Date.parse(input.issued)) || input.now - Date.parse(input.issued) > 12 * 3600000;
  const windows = Object.fromEntries([24, 48, 72, 168].map((hours) => {
    const { hours: discarded, ...view } = summarize(input.periods, pointAlerts, input.now, hours);
    void discarded;
    return [hours, { ...view, complete: view.complete && input.alertsOk && !oldForecast }];
  }));
  const failed = !input.weatherOk || !input.alertsOk;
  const failures = failed ? (input.priorFailures ?? 0) + 1 : 0;
  return {
    key: input.siteKey,
    ...(input.loc ?? {}),
    grid: input.grid,
    alertPoint: input.alertPoint,
    alertsIsolated: true,
    execution: "provider",
    alertsChecked: input.alertsOk,
    ...summary,
    windows,
    updated: new Date(input.now).toISOString(),
    issued: input.issued,
    complete: summary.complete && input.alertsOk && !oldForecast,
    status: !input.weatherOk || !input.alertsOk ? "partial" : oldForecast ? "stale" : "ok",
    error: !input.weatherOk ? "Hourly forecast unavailable." : !input.alertsOk ? "NWS alert check unavailable." : oldForecast ? "Forecast issue time is old or missing." : null,
    lastAttempt: new Date(input.now).toISOString(),
    failures,
    nextRetry: failed ? input.now + retryDelay("temporary", failures) : undefined,
    sourceAddress: input.sourceAddress,
  };
}

export function buildFailureRecord(input: { siteKey: string; sourceAddress?: string; error: string; priorFailures?: number; now: number }) {
  const failureKind = /Address/.test(input.error) ? "address" : "temporary";
  const failures = (input.priorFailures ?? 0) + 1;
  return {
    key: input.siteKey,
    sourceAddress: input.sourceAddress,
    status: "error" as const,
    error: input.error,
    failureKind,
    failures,
    lastAttempt: new Date(input.now).toISOString(),
    nextRetry: input.now + retryDelay(failureKind, failures),
    updated: new Date(input.now).toISOString(),
    priority: 0,
    complete: false,
    hours: [] as unknown[],
    alerts: [] as unknown[],
    hazards: [] as unknown[],
    onset: null,
    minTemp: null,
    alertsChecked: false,
    execution: "provider" as const,
  };
}
