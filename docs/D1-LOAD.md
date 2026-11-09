# Loading a reviewed slice into local D1

The procedural importer in `lib/site-import.ts` is a Node sqlite tool. It uses `BEGIN`/`COMMIT` and is not the worker path. A D1 load of a reviewed slice is 1 to 40 sites, inserted unactivated, in one batch.

Generate the transaction from a JSON file that is not committed:

```bash
node --experimental-strip-types scripts/d1-seed-sql.mjs --json /tmp/reviewed-sites.json > /tmp/reviewed-seed.sql
```

Each object needs `sourceSiteId`, `address`, `state`, and `classification`. The script refuses more than 40 rows.

Apply it to local D1 with the single Wrangler config:

```bash
npx wrangler d1 execute winter-watch-pilot --local --config wrangler.jsonc --file db/0001_pilot.sql
npx wrangler d1 execute winter-watch-pilot --local --config wrangler.jsonc --file /tmp/reviewed-seed.sql
```

`applySeedBatch` uses D1 `batch()`, which commits all statements or none. The sites stay `operational = 0` until `POST /api/admin/sites`.

Do not point this at a hosted database from this repository. Hosted D1 is a later gate.
