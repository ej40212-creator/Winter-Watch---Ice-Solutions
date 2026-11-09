# Ice Solutions Winter Watch — private pilot

This repository is a reviewable Cloudflare Workers + D1 foundation for the Ice Solutions Winter Watch dashboard. It is a private pilot for team vetting. It is not a production deployment, and it does not claim a measured fleet refresh or a verified unattended scheduler.

The original ChatGPT Sites project id and `chatgpt.site` origin are not in this tree. Do not publish this pilot back to the original hosted site.

## What runs here

- The dashboard preserves the exported screening rules in `lib/risk.ts`, the outlook windows (24 / 48 / 72 / 168 hours), and the Ice Solutions branding.
- The runnable UI loads six clearly labeled synthetic sites from `fixtures/synthetic-sites.json`. The source workbook is not in the client bundle.
- With `PILOT_SYNTHETIC_DATA=1`, weather and observations are simulated fixtures. The screen says so.
- Synthetic sign-in is dev-build and loopback only. It is absent from the production wrangler config. It is not Cloudflare Access.
- Real inventory import is an offline tool. Imported sites stay `pending_review` and `operational = 0` until a person activates them. Nothing in this pilot activates them.

## Checks

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

`pnpm test` runs the original risk, daily, coverage, observation, and analytics checks plus the pilot checks. Set `WINTER_WATCH_XLSX` to the lineage workbook to also account all 3,095 input rows. The workbook and the provisional inventory are not committed.

```bash
node --experimental-strip-types scripts/import-sites.mjs --xlsx workbook.xlsx --out /tmp/winter-watch.pilot.sqlite
```

The import refuses to write into `public/`, `lib/`, `app/`, or `fixtures/`.

## Local synthetic UI

```bash
node --experimental-strip-types scripts/start-pilot.mjs
```

That process generates a local signing key outside the repo, enables synthetic data, and starts the dev server. Unsigned requests fail closed. A forged `oai-authenticated-user-id` header grants nothing.

## Docs

- `docs/PILOT-ARCHITECTURE.md` — schema, auth, import, cache, and scheduler choices
- `docs/DEPLOYMENT-PREREQUISITES.md` — what must be decided before any Cloudflare project exists
- `docs/OPEN-BLOCKERS.md` — what this increment does not prove
- `docs/evidence/` — command logs from this change
