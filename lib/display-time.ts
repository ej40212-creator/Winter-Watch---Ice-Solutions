/** Every displayed instant names the zone it was formatted in. */
export function formatInstant(value: string | undefined, timeZone: string, role: "checked" | "issued" | "risk"): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unavailable";
  let zone = timeZone || "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const rendered = new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  });
  const label = role === "checked" ? "browser" : "site";
  return `${rendered} (${label} ${zone})`;
}
