/** Cookie writes need Origin or Sec-Fetch-Site. Access sends Cf-Access-Jwt-Assertion on cookie requests too, so that header alone is not a bearer exception. */
export function allowsWrite(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  const hasCookie = cookie.split(";").some((part) => part.trim().startsWith("CF_Authorization="));
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (hasCookie) {
    if (fetchSite === "same-origin" || fetchSite === "none") return true;
    if (!origin) return false;
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return Boolean(request.headers.get("cf-access-jwt-assertion"));
}
