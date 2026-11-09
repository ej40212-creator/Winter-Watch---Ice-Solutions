# Activation rollback

Activation and deactivation are both audited. Neither deletes a site.

To undo an activation, an admin sends:

```json
{ "siteId": "<site id>", "decision": "deactivate" }
```

to `POST /api/admin/sites`. The site returns to `operational = 0` and `status = pending_review`. The audit table gains a `deactivate` row with the admin email.

If the API is unavailable, the same change on a local database is:

```sql
BEGIN;
UPDATE sites SET operational = 0, status = 'pending_review', updated_at = '<iso time>' WHERE site_id = '<site id>';
INSERT INTO site_activation_audit(audit_id, site_id, actor, decision, note, created_at)
VALUES ('<new ulid>', '<site id>', '<admin email>', 'deactivate', 'Manual rollback', '<iso time>');
COMMIT;
```

A failed `batch()` does not need this rollback: D1 does not keep the update without the audit insert. Open duplicate or address reviews, and excluded or merged rows, are refused before that batch.
