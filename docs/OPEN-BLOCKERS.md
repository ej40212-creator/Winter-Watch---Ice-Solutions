# Open blockers

These items are still open after this increment. None of them is implied to be done.

| Blocker | Why it is still open |
|---|---|
| Cloudflare account, Access policy, and cost | Eric approved the direction. Nobody has provisioned the account or named the admin allowlist. |
| Owner review of pilot sites | 3,094 candidates, 23 repeated ids (46 rows), and 108 address flags are accounted and unactivated. No row has an owner decision. |
| Duplicate pairs | Rows that share a source id but not the same address stay separate. Identical content fingerprints share one site id. The importer does not decide that a repeated-id pair is one store. |
| Leading zeros | The workbook stored store numbers as Excel integers. This import does not invent padding. |
| Address corrections | Flagged rows are queued. No ZIP, city, or street correction is applied. |
| Scheduler proof | Lease, cap, backoff, stolen-lease stop, and recovery are covered by simulated tests. Two browser-closed hosted cycles with database readback have not run. Delivery is at-least-once if a provider call finishes and the process stops before the effect row is written. |
| Provider budget and cadence | `PROVIDER_BUDGET` and `REFRESH_DUE_AFTER_MS` are unset on purpose. Live routes stay cache-only until both refresh authorization and a budget exist. |
| AccuWeather | Disabled until a key and confirmed display rights both exist. |
| Production claim | Not made. The local synthetic UI and the unit tests are the evidence in this change. |
| Formal accessibility audit | Focus rings, non-color status text, stacked fields under 800px, and reduced motion are in the UI. A WCAG 2.2 AA audit, a 320px pass, and a 200% zoom pass were not completed. |

## Explicitly not done

- No merge to the default branch.
- No change to the original hosted site.
- No live credential use.
- No unattended provider refresh.
- The raw workbook and the full provisional inventory are not in the repository.
