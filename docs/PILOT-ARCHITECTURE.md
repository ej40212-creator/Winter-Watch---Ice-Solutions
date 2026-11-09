# Private-pilot architecture

This increment keeps the exported Winter Watch application and adds a fail-closed identity gate, a reorder-stable import, and a bounded refresh runner. It does not provision Cloudflare, and it does not turn the 3,094 workbook rows into the on-screen fleet.

## Baseline

The repository was empty aside from a title README. The application baseline was copied from `source/` in the handoff archive. There was no existing Winter Watch tree to reconcile. Before the pilot code changed, `tsc --noEmit` and the five exported unit scripts passed on Node v22.23.4. That log is `docs/evidence/baseline-tests.log`. The original ChatGPT Sites project id and public origin were removed before the first commit. They are not reused.

## Identity

Persistent site identity is a ULID stored in `sites.site_id`. It is minted once. It is not derived from `sheet1-r{row}`, and that key is stored only as lineage on `site_source_rows`. ULID was a team suggestion; the important property is that the value is not recomputed when the file is reordered.

Matching, in order:

1. The same file SHA-256 is a no-op. Lineage and review rows are not duplicated.
2. A unique content fingerprint (`sha256("v1|" + source id + "|" + state + "|" + normalized address)`) reuses the existing `site_id`. Normalization is only for matching. The stored address is not rewritten.
3. A repeated source id in the same state is kept as separate sites. One open `dup_source_id` review item lists the candidate ids. Nothing is merged.
4. A unique source id whose address fingerprint changed reuses the site id, keeps the stored address, and queues `address_changed`.
5. A row absent from a later file stays in `sites` and queues `missing_in_new_batch`.
6. DC is lineage plus `coverage_excluded`. It does not become a site.
7. New inventory rows are `pending_review` and `operational = 0`.

Address flags use an end-anchored ZIP check. A 5-digit street number is not treated as a ZIP. The workbook check in this environment flagged 108 included rows, matching the earlier count. The older label that marked only 97 of them `address_missing_zip` is not copied. No leading zeros are added or removed. Digit strings are preserved as given; Excel integers become their decimal form because that is what the file contains.

Region is the site's state. That follows the approved rule. A source region that disagrees is queued as `region_mismatch` and is not used as the stored region.

## Authentication

Every non-asset request needs a verified RS256 JWT from `Cf-Access-Jwt-Assertion` or the `CF_Authorization` cookie. Verification checks the signature, `aud`, `iss`, `exp`, and `nbf`. `oai-authenticated-user-id` and `Cf-Access-Authenticated-User-Email` are not read as identity.

Admin, MCP, refresh, and performance routes also require an email or group on the server allowlist. If the allowlist is empty, those routes stay closed for everyone. If audience, issuer, or signing keys are missing, the response is `configuration_required` (503), not an open app.

Synthetic sign-in is compiled only into dev builds (`import.meta.env.DEV`), and the request host must be loopback. A production bundle returns 404 for `/api/pilot-session` even if `PILOT_SYNTHETIC_AUTH=1`. The production wrangler config does not receive `PILOT_SYNTHETIC_*` or a private key. A local success is not a Cloudflare Access validation. Deployed JWKS loading uses the team certs URL; static `ACCESS_JWKS_JSON` cannot override that URL.

## Cache

Hourly grid forecasts are stored under `grid-forecast-v1:<grid url>`. That write is rejected if the payload contains an alert `features` or `alerts` array. Point alerts are stored under `point-alerts-v1:<lat>,<lon>`. Site outlooks are stored under `outlook-v3:<site id>` and record the grid id and the alert point separately. Two sites on one grid can share the forecast document and still receive different alert lists.

Authenticated API responses set `Cache-Control: private, no-store`.

## Scheduler

`runBoundedCycle` takes a lease in `refresh_leases` (180s). A second caller while the lease is held gets `busy` and does not call the provider function. An expired lease can be taken; unfinished `leased` jobs are marked abandoned and can be retried; jobs already `ok` are not sent to the provider again in that recovery. Each attempt records start and finish timestamps, and failures record the error and a backoff from the existing `retryDelay`. The batch size is capped at 40. There is no cron trigger in `pilot.wrangler.jsonc`. `SCHEDULER_ENABLED` and `PROVIDER_REFRESH` are unset. An admin POST to `/api/refresh` returns `not_authorized` and does not fetch weather until `PROVIDER_REFRESH=authorized`. Cadence and provider budget are not chosen here.

## UI

The overview still uses the exported queue, outlook controls, map, briefing, and brand assets. Synthetic mode labels the pilot, separates current observation from forecast low, shows a real 0°F as 0°F, and shows a missing value as Unavailable. Check time and forecast issue time are separate. CSV export is the filtered queue in view, and the control says so. The admin review queue can record only `keep_separate` or `defer`. Below 800px CSS the queue fields stack and the old 1100px table minimum is removed.

## What was executed

Unit tests and `tsc --noEmit` ran in Node. The workbook accounting ran in this environment against the uploaded xlsx and was not committed. `pnpm build` completed. A local Vite server was exercised with synthetic JWTs. Screenshots are of that local synthetic UI. None of those steps is a Cloudflare Access check, a hosted D1 check, or a browser-closed scheduled cycle.
