const ISSUED = "2026-11-09T15:00:00.000Z";
const ONSET = "2026-11-09T18:00:00.000Z";
const END = "2026-11-10T06:00:00.000Z";

function hours(temp: number | null) {
  return [0, 3, 6].map((offset) => ({
    time: new Date(Date.parse(ONSET) + offset * 3600000).toISOString(),
    end: new Date(Date.parse(ONSET) + (offset + 1) * 3600000).toISOString(),
    temp,
    dew: temp == null ? null : temp - 4,
    rh: temp == null ? null : 70,
    pop: temp == null ? null : 40,
    summary: temp == null ? "" : "Synthetic forecast hour",
    wind: "10 mph",
    hazards: [] as string[],
  }));
}

function windowFor(priority: number, minTemp: number | null, hazards: string[], alerts: unknown[], complete: boolean) {
  return { priority, complete, onset: complete ? ONSET : null, hazards, alerts, minTemp, missingFields: minTemp == null ? ["temperature"] : [] };
}

const simulatedAlert = {
  id: "synthetic-alert-1",
  event: "Winter Storm Warning",
  headline: "Synthetic winter storm warning",
  description: "Simulated alert for the private-pilot fixture. This is not an NWS product.",
  onset: ONSET,
  expires: END,
  ends: END,
  effective: ONSET,
  status: "Actual",
  messageType: "Alert",
};

type Seed = {
  status: string;
  priority: number;
  minTemp: number | null;
  hazards: string[];
  alerts: unknown[];
  complete: boolean;
  error: string | null;
  stale?: boolean;
  issued: string | null;
};

const seeds: Record<string, Seed> = {
  "syn-co-01": { status: "ok", priority: 4, minTemp: 18, hazards: ["Snow"], alerts: [simulatedAlert], complete: true, error: null, issued: ISSUED },
  "syn-mn-01": { status: "ok", priority: 3, minTemp: 28, hazards: ["Freezing precipitation"], alerts: [], complete: true, error: null, issued: ISSUED },
  "syn-tx-01": { status: "ok", priority: 0, minTemp: 46, hazards: [], alerts: [], complete: true, error: null, issued: ISSUED },
  "syn-oh-01": { status: "error", priority: 0, minTemp: null, hazards: [], alerts: [], complete: false, error: "Simulated provider failure. No weather value was invented.", issued: null },
  "syn-wa-01": { status: "ok", priority: 1, minTemp: 0, hazards: ["Frost risk"], alerts: [], complete: true, error: null, issued: ISSUED },
  "syn-ga-01": { status: "partial", priority: 0, minTemp: null, hazards: [], alerts: [], complete: false, error: "Hourly forecast unavailable.", issued: null },
};

export function syntheticOutlook(key: string, now = Date.now()) {
  const seed = seeds[key];
  if (!seed) return null;
  const updated = new Date(seed.stale ? now - 6 * 3600000 : now - 5 * 60000).toISOString();
  const view = windowFor(seed.priority, seed.minTemp, seed.hazards, seed.alerts, seed.complete);
  return {
    key,
    status: seed.status,
    execution: "simulation",
    source: "synthetic-fixture",
    simulated: true,
    updated,
    issued: seed.issued,
    lastAttempt: updated,
    timezone: "America/Denver",
    complete: seed.complete,
    alertsChecked: seed.status !== "error",
    priority: seed.priority,
    onset: view.onset,
    hazards: seed.hazards,
    alerts: seed.alerts,
    minTemp: seed.minTemp,
    error: seed.error,
    hours: seed.minTemp == null && seed.status !== "ok" ? [] : hours(seed.minTemp),
    windows: { 24: view, 48: view, 72: view, 168: view },
    grid: "SYNTHETIC/1,1",
    alertPoint: "synthetic",
    alertsIsolated: true,
  };
}

export function syntheticSnapshot(now = Date.now()) {
  return Object.keys(seeds).map((key) => {
    const row = syntheticOutlook(key, now)!;
    const { hours: discarded, ...rest } = row;
    void discarded;
    return rest;
  });
}

export function syntheticCurrent(key: string, now = Date.now()) {
  if (key === "syn-wa-01") {
    return { status: "ok", execution: "simulation", temperature: 0, feelsLike: -2, humidity: 60, dewpoint: -6, wind: 8, gust: null, description: "Synthetic clear and cold", station: "SYN", stationName: "Synthetic station", observedAt: new Date(now - 10 * 60000).toISOString(), timezone: "America/Los_Angeles" };
  }
  if (key === "syn-oh-01") {
    return { status: "unavailable", execution: "simulation", temperature: null, error: "Simulated observation failure. Missing is not shown as zero.", observedAt: null, timezone: "America/New_York" };
  }
  if (key === "syn-ga-01") {
    return { status: "ok", execution: "simulation", temperature: 40, station: "SYN", stationName: "Synthetic delayed station", observedAt: new Date(now - 4 * 3600000).toISOString(), timezone: "America/New_York", description: "Synthetic delayed observation" };
  }
  if (!seeds[key]) return null;
  return { status: "ok", execution: "simulation", temperature: 33, feelsLike: 30, humidity: 80, dewpoint: 28, wind: 6, gust: null, description: "Synthetic observation", station: "SYN", stationName: "Synthetic station", observedAt: new Date(now - 15 * 60000).toISOString(), timezone: "America/Denver" };
}

export function syntheticReview() {
  return {
    source: "synthetic-fixture",
    execution: "simulation",
    note: "Sample review queue for the private pilot. These are not workbook rows, and nothing here has been owner-reviewed.",
    items: [
      { reviewId: "syn-rev-dup", reason: "dup_source_id", detail: "Two synthetic rows share an id and were kept separate. No merge was applied.", candidateSiteIds: ["syn-row-a", "syn-row-b"], provisionalKey: "fixture-dup", siteId: null, resolution: null },
      { reviewId: "syn-rev-address", reason: "address_flag", detail: "address_missing_zip,address_incomplete_postal_form. No ZIP or leading-zero correction was invented.", candidateSiteIds: ["syn-row-c"], provisionalKey: "fixture-address", siteId: "syn-row-c", resolution: null },
      { reviewId: "syn-rev-dc", reason: "coverage_excluded", detail: "Synthetic stand-in for a coverage exclusion. The workbook DC row is not loaded.", candidateSiteIds: [], provisionalKey: "fixture-excluded", siteId: null, resolution: null },
    ],
  };
}

export function syntheticEnabled(workerEnv?: { PILOT_SYNTHETIC_DATA?: string }): boolean {
  return workerEnv?.PILOT_SYNTHETIC_DATA === "1" || process.env.PILOT_SYNTHETIC_DATA === "1";
}
