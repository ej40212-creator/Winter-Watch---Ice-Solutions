# Daily forecast sources

NWS day/night forecasts load on demand through `/api/daily?key=<supplied-site-key>&provider=nws`. Results are cached in the existing D1 weather cache for 15 minutes, failed requests for 2 minutes. Existing hourly screening and warning priorities are unchanged. Day cards use local dates, include partial boundary dates, and explicitly retain missing periods/values. They do not infer pavement icing or amounts from daily descriptions.

The NOAA/WPC tab imports WSSI days 1–3 regional impact polygons for the selected coordinates. Pivotal remains an external model reference, not an imported feed. NOAA and NWS must not be counted as independent providers. Do not mirror Pivotal charts without appropriate authorization.

## Optional AccuWeather connection

The server supports `ACCUWEATHER_API_KEY` as a hosted secret. Configure it only after the owner provides an authorized AccuWeather API subscription with seven-day forecast access and appropriate public display rights. Use the Sites environment-variable tool with `is_secret: true`; never place the key in browser code or the hosting manifest. Redeploy to apply the secret.

The adapter uses Bearer authorization, geoposition location lookup and `/forecasts/v1/daily/7day/{locationKey}?details=true&metric=false`. Location lookups are cached for 30 days and forecasts for 15 minutes. No paid provider calls run until the secret is configured. No dashboard-wide AccuWeather scan runs: only the requested site is fetched. A missing key is shown as an external reference, not live data. Provider failures are not silently replaced by NWS under the AccuWeather label. Issue time is marked unavailable when the provider does not supply one.

Official references:
- https://www.weather.gov/documentation/services-web-api
- https://developer.accuweather.com/core-weather/location-key-daily
- https://developer.accuweather.com/documentation/authentication
- https://developer.accuweather.com/documentation/location-keys
- https://home.pivotalweather.com/terms
- https://home.pivotalweather.com/subscriptions

Validation: `node --experimental-strip-types scripts/test-daily.mjs`, `node --experimental-strip-types scripts/test-risk.mjs`, and TypeScript/build checks.

## NOAA radar and winter impact guidance

`/api/radar?key=...` resolves a supplied site using the existing verified location path and queries the NOAA MRMS ImageServer catalog for 12 recent intersecting frames. The browser renders exact catalog raster IDs over standard OpenStreetMap tiles (visible attribution and normal browser caching). Zoom stays centered on the site. Frames are observations, not precipitation-type forecasts; empty echoes do not imply no precipitation. Catalog checks run every 5 minutes; observations older than 20 minutes are marked delayed. Image errors are explicit. Playback requests only the selected frame. No paid API is used.

`/api/winter-guidance?key=...` queries NOAA WSSI layers 1/2/3, checks national product metadata, and intersects polygons at the site point. Empty point results mean outside mapped areas, not zero risk. Issue times older than 12 hours or missing are marked stale. Missing products are unavailable. WSSI covers the contiguous US and fixed product periods; it does not cover the entire week and never changes NWS warning priorities. Responses are cached for 10 minutes.

- https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer
- https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer
- https://operations.osmfoundation.org/policies/tiles/
