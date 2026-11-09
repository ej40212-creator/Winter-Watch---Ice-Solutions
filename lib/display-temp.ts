/** Forecast-low display. A missing value stays unavailable; a real 0°F stays 0°F. */
export function formatForecastLow(value: unknown, available: boolean): { text: string; unavailable: boolean } {
  if (!available || typeof value !== "number" || !Number.isFinite(value)) {
    return { text: "Unavailable", unavailable: true };
  }
  return { text: `${Math.round(value)}°F`, unavailable: false };
}
