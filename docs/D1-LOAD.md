# Loading a reviewed slice

Apply a reviewed seed once, to an empty D1 database. The payload is 1 to 40 sites. It is produced by the workbook importer, so the fingerprint, source system, lineage, and review flags match a later import of the same rows. Site, batch, and review ids are derived from the file hash and the content fingerprint. Regenerating the payload does not mint a second set of ids. The sites stay `operational = 0`.

Generate the payload from a JSON file that is not committed. This command does not write to a database:

```bash
node --experimental-strip-types scripts/d1-seed-sql.mjs --json /tmp/reviewed-sites.json > /tmp/reviewed-seed.json
```

Each object needs `sourceSiteId`, `address`, `state`, and `classification`. `provisionalKey` is optional. The script refuses more than 40 rows. The output is `{ "sha256", "statements" }` for `applySeedBatch`. It is not SQL text.

The only apply path is `POST /api/admin/seed`. The route is off unless `SEED_ENDPOINT_ENABLED=enabled`. Turn that on for the one-time load, call the route, then unset it. An admin posts `acknowledgement: "owner-reviewed"`, the `sha256`, and the `statements`. Each statement must match an importer template. Sites must be `pending_review` and `operational = 0`, and reviews must be unresolved. The handler recomputes the file hash from those rows, runs `applySeedBatch` on the bound D1 database, sets `imported_by` to the admin email, writes the seed audit rows in that same batch, and reads back counts for sites, import batches, source rows, and reviews. A refused or failed attempt is audited.

The same file hash returns those counts and writes no inventory rows. A database that already has other sites or reviews is refused. A failed batch leaves no partial seed.

The pilot schema has to be present before the first call. Creating or pointing this repository at a hosted database is a later gate. When that database is bound as `DB`, this endpoint is the hosted path.
