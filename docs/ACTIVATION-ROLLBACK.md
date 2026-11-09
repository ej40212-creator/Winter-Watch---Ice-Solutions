# Activation rollback

Activation and deactivation are both audited. Neither deletes a site.

To undo an activation, an admin sends:

```json
{ "siteId": "<site id>", "decision": "deactivate" }
```

to `POST /api/admin/sites`. The site returns to `operational = 0` and `status = pending_review`. The audit table gains a `deactivate` row with the admin email.

If the API is unavailable, the same change on local D1 is two statements. Do not wrap them in `BEGIN` or `COMMIT`. Wrangler’s local D1 rejects those statements.

```sql
UPDATE sites SET operational = 0, status = 'pending_review', updated_at = '<iso time>' WHERE site_id = '<site id>';
INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at)
VALUES ('<new ulid>', '<site id>', '<admin email>', 'deactivate', 'Manual rollback', '<iso time>');
```

Apply them with `npx wrangler d1 execute winter-watch-pilot --local --config wrangler.jsonc --command "<one statement>"` twice, or as a file that contains only those two statements. The admin API writes both in one `batch()`, which is the atomic path. A failed `batch()` does not need this rollback. Open duplicate, exact-duplicate, missing-batch, and address reviews stay blocking while they are unresolved or deferred. Excluded or merged rows are refused before that batch.
