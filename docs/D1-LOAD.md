# Loading a reviewed slice into local D1

A reviewed load is 1 to 40 sites. The statements come from the workbook importer, so the content fingerprint, source system, lineage rows, and address or duplicate review flags match a later import of the same rows. The sites stay `operational = 0`. Running the same statements again is a no-op: inserts use `INSERT OR IGNORE`, and `(source_system, content_fp)` is unique for sites that are not excluded.

Generate the statements from a JSON file that is not committed:

```bash
node --experimental-strip-types scripts/d1-seed-sql.mjs --json /tmp/reviewed-sites.json > /tmp/reviewed-seed.sql
```

Each object needs `sourceSiteId`, `address`, `state`, and `classification`. `provisionalKey` is optional. The script refuses more than 40 rows.

The tested all-or-nothing apply path is `applySeedBatch`, which uses D1 `batch()` (or one sqlite transaction in the Node tool). A failed statement leaves no partial seed. `scripts/d1-batch-evidence.ts` is a local wrangler entrypoint for that check. It is not the application worker. Post `{ "statements": [...] }` to it. `wrangler d1 execute --file` is not that path: local D1 rejects `BEGIN`/`COMMIT`, and a multi-statement file is not one transaction.

Apply the pilot schema, which is idempotent, with:

```bash
npx wrangler d1 execute winter-watch-pilot --local --config wrangler.jsonc --file db/0001_pilot.sql
```

Do not point this at a hosted database from this repository. Hosted D1 is a later gate.
