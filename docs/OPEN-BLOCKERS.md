# Open blockers

These items are still open after this increment. None of them is implied to be done.

| Blocker | Why it is still open |
|---|---|
| Cloudflare account, Access policy, and cost | Eric approved the direction. Nobody has provisioned the account or named the admin allowlist. |
| Owner review of pilot sites | 3,094 candidates, 23 repeated ids (46 rows), and 108 address flags are accounted and unactivated. No row has an owner decision. |
| Duplicate pairs | The importer keeps both rows. It does not decide that a pair is one store. |
| Leading zeros | The workbook stored store numbers as Excel integers. This import does not invent padding. |
| Address corrections | Flagged rows are queued. No ZIP, city, or street correction is applied. |
| Scheduler proof | Code covers a lease, a 40-site cap, backoff, and recovery in simulated tests. Two browser-closed hosted cycles with database readback have not run. |
| Provider budget and cadence | Not selected. `/api/refresh` refuses live calls until `PROVIDER_REFRESH=authorized`. |
| AccuWeather | Disabled until a key and confirmed display rights both exist. |
| Production claim | Not made. The local synthetic UI and the unit tests are the evidence in this change. |
| Formal accessibility audit | Focus rings, non-color status text, stacked fields under 800px, and reduced motion are in the UI. A WCAG 2.2 AA audit, a 320px pass, and a 200% zoom pass were not completed. |

## Explicitly not done

- No merge to the default branch.
- No change to the original hosted site.
- No live credential use.
- No unattended provider refresh.
- The raw workbook and the full provisional inventory are not in the repository.
