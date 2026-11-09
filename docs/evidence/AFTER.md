# After-change evidence

Recorded 2026-11-09 on Node v22.23.4 after the pilot changes. These commands ran in this workspace. They are not a hosted Cloudflare validation.

## Typecheck and unit tests

```bash
node node_modules/typescript/bin/tsc --noEmit
WINTER_WATCH_XLSX=/path/to/lineage.xlsx node scripts/test-pilot.mjs
```

Both exited 0. `test-pilot.mjs` runs the five original scripts and the pilot scripts. With the workbook path set, the import test also checked all 3,095 input rows: 3,094 unactivated sites, 23 open duplicate-id reviews covering the repeated ids, 108 address-flag reviews, 1 DC exclusion, a no-op repeat of the same file hash, and unchanged site ids after the lineage keys were rewritten and reversed. The log is `after-tests.log`. Addresses were not printed.

## Production build

```bash
pnpm build
```

Exited 0. Vinext reported the app and API routes, including `/api/admin/review`, `/api/refresh`, `/api/pilot-session`, and `/mcp`. The log is `after-build.log`. The build was not deployed.

## Local server, synthetic identity

`node --experimental-strip-types scripts/start-pilot.mjs` served `http://127.0.0.1:5173` with synthetic auth and synthetic weather. Observed with curl:

- No token, `Accept: application/json`: 401 `A valid Cloudflare Access token is required.`
- No token, `Accept: text/html`: 401 HTML with the local synthetic sign-in form.
- `oai-authenticated-user-id: forged` on `/api/refresh`: 401.
- The same forged header on `POST /mcp`: 401.
- A locally signed operator JWT: 200 on `/`, 403 on `/api/performance` and `POST /api/refresh`.
- A locally signed admin JWT: 200 on `/api/performance` with empty buckets and `execution: simulation`; 200 on `/api/admin/review` with `source: synthetic-fixture`; 409 on `POST /api/refresh` with `execution: not_run` and no provider fetch.
- `/api/weather?key=syn-ga-01`: 200, `execution: simulation`, `status: partial`, `minTemp: null`.

The tokens were signed with a key generated in `/tmp` for that process. This is not Cloudflare Access. The JWTs are not stored in the repo.

Screenshots of that same local UI are in this directory: overview and queue at 1280px and 390px. Weather in those images is simulated.
