# Deployment prerequisites

No Cloudflare account, D1 database, Access application, queue, or cron was created for this pilot. Do not treat the placeholder ids below as provisioned resources.

## Must be decided before any paid or public resource

1. Who owns the Cloudflare account, and who pays for Workers and D1.
2. The Access team domain, application audience tag, and the admin email or group allowlist. Until those exist, the worker stays in `configuration_required`.
3. Whether site addresses may be stored in that D1 database. The import tool can load them later; this repo does not contain them.
4. Which reviewed sites, if any, become `operational = 1`. None are owner-reviewed. The synthetic fixtures are the only on-screen set.
5. The refresh cadence and the provider request budget. NWS, Census, MRMS, WSSI, and OSM usage policies still need a review against the current vendor terms. This code will not pick those numbers.
6. AccuWeather stays off unless both `ACCUWEATHER_API_KEY` and `ACCUWEATHER_RIGHTS_CONFIRMED=authorized` are set from a plan that allows the display. Neither is set.
7. The public origin (`PILOT_PUBLIC_ORIGIN`). The original chatgpt.site origin is not a candidate.

## Schema to apply on a new D1 database

Apply, in order, on a newly created database bound as `DB`:

1. `drizzle/0000_greedy_apocalypse.sql`
2. `db/0001_pilot.sql`

`pilot.wrangler.jsonc` shows the binding name and intentionally omits cron triggers. Replace `database_id` with the id from the new database. The placeholder is not a real database.

Suggested worker vars, all unset until the decisions above exist:

- `ACCESS_TEAM_DOMAIN` or `ACCESS_ISSUER`
- `ACCESS_AUD`
- `ADMIN_EMAILS` and/or `ADMIN_GROUPS`
- `SCHEDULER_ENABLED` left unset
- `PROVIDER_REFRESH` left unset. Live Census/NWS/NOAA calls also require `PROVIDER_BUDGET` set to a positive integer. That value is intentionally unset here, so reads stay cache-only.
- `REFRESH_DUE_AFTER_MS` left unset. Successful sites are held and reported, not silently dropped and not given an invented cadence.
- `OPERATOR_RATE_LIMIT_PER_MINUTE` left unset. The code then uses 150 per minute, because one queue load can call `/api/current` for each site in a 40-site batch. `accessIdentity` calls `consumeDurableRate` on the D1 `identity_rate` table when `DB` is bound. A missing table or other D1 error returns 503. When D1 is not bound, the same ceiling is the per-isolate map, which drops windows older than two minutes. Live provider calls never use that map; each fetch attempt requires the D1 `provider_budget` counter.
- `SEED_ENDPOINT_ENABLED` left unset. The seed route stays disabled. Set it to `enabled` only for the one-time reviewed load, then unset it.
- `ACCUWEATHER_RIGHTS_CONFIRMED` left unset
- Do not set `PILOT_SYNTHETIC_AUTH`, `PILOT_SYNTHETIC_DATA`, or `PILOT_SYNTHETIC_PRIVATE_JWK` on a deployment. Production builds omit them, and synthetic sign-in is compiled out unless `import.meta.env.DEV` is true and the host is loopback.

Do not set `PILOT_SYNTHETIC_AUTH` or `PILOT_SYNTHETIC_DATA` on a shared deployment. Those flags are for the local harness only.

## Still required after a host exists

- Two scheduled cycles with the browser closed, then a D1 readback of `refresh_cycles` and `site_refresh_state`.
- A measured refresh of whatever operational set is actually activated, with the chosen batch cap and an observed provider error rate.
- Those two results are future gates. This increment does not claim them.
