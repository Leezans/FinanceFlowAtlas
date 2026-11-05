# Private hosted proof: independent TIC layer

This deployment proof preserves the Vinext Sites starter's worker, connector integration, authentication boundary, and hosting manifest. It does not replace the Python monorepo architecture. No secrets, upload route, writer API, seed observations, captured source data, or scheduler are included.

## Frontend

The connected TIC React interface is rendered by `app/page.tsx`. IMF, foreign exchange, futures and crypto controls are not part of this monthly TIC view; A-share and selected Kraken spot evidence are separate routes and are never combined with TIC. The unchanged IMF status/snapshot routes still report unavailable/503. Geography uses the bundled attributed Natural Earth polygons and ISO index. Source methodology and zero-row lists are collapsed with accessible summaries; errors, stale warnings and the essential tile-area/sign/unit semantics remain visible.

TIC selects the latest complete, validated month present in the fetched official source table and rolls its twelve-month history to that month. It does not infer release availability from the clock. The UI labels the returned observation periods. The foreign country indicates reported residence; the security issuer economy remains the United States even for negative transactions. Monthly net transactions are never mixed with IMF holdings, approximated from holdings differences, or presented as real-time flows. The TIC layer does not supply industry/individual-security data.

## Server routes and D1

- GET `/api/v1/flows/tic/status` and GET `/api/v1/flows/tic` both read through the cache, so the initial status request can obtain the first verified snapshot.
- Direct HTTPS source: `https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt`. No connector, keys, third-party proxy or arbitrary target is used. Redirects are rejected. Download limit 10 MB; fetch deadline 12 seconds.
- The TypeScript port of the reviewed Python parser checks title, millions-of-dollars source units, machine header, footer, explicit Treasury country-code/name mappings, duplicate rows, numeric precision, period and official grand total. Zod validates the saved and returned snapshot. Unknown revision-publication time stays null. Raw SHA-256 and deterministic snapshot identity are retained.
- D1 binding `DB`, table `tic_snapshot_cache`; separate versioned keys for latest-month country and rolling-history snapshots, with validated legacy-key migration. Only validated public snapshot JSON, version, check times, errors and a short concurrency lease are stored. No user identity data.
- Successful source checks are reused for 24 hours. Failure checks back off five minutes. A 30-second token lease avoids concurrent upstream work and prevents old requests overwriting a newer result.
- Failed refresh preserves the last-good snapshot with stale status. Initial absence returns 503 with no substitute data. The snapshot ETag includes source-check state so stale transitions invalidate client 304 caches.
- Checks occur only on user/read requests. No background schedule or external writer endpoint is created.

## Checks

Run `npm test` (or `npx vitest run --config vitest.config.ts`) for synthetic adapter/cache/UI tests. No financial fixture is imported into production code. Run `npx tsc --noEmit`, then use the supported Sites build/preview/publication workflow. `npm run db:generate` creates the D1 migration; the operator applies local migration and publishes via supported Sites tooling. Source and authentication publication choices remain with the operator.

## Country treemap review increment

The primary TIC visualization is now a grouped rectangular treemap, with a geographic-map tab. It uses d3-hierarchy squarify, grouping the actual reported foreign-residence rows by the geographic index's region. Region headers and country tiles support drilldown, with a breadcrumb back to the complete reported-country view. This is not an industry or individual-stock hierarchy.

Tile weight is the absolute signed monthly net transaction amount. Its denominator is only the sum of absolute net amounts of the included reported country rows; it is neither market capitalization, gross purchases/sales, nor the Treasury Grand Total. Negative amounts retain their original identity and sign. Reported zero rows appear separately with no positive-area tile; missing rows receive no area and an unavailable denominator is shown as a dash. The China/global palette toggle changes color conventions only. Keyboard labels and single-string SVG titles provide full values where tiles are too small for labels. Responsive layout recomputes rectangles rather than shrinking a desktop image.

The focused hosted UI exposes only the available TIC surface. The source-discovered observation month is read-only: unsupported historical months are not presented as a user-selectable feature. Visible signed-direction controls and buy/sell wording describe foreign-resident accounts' net U.S. equity transactions, not changes in countries' aggregate money or wealth. Signed summaries group reported country net amounts, not gross trading amounts or an official global total. Source methodology, unsupported coverage and geography-license/download links remain in the folded source disclosure. Access-triggered checking and absence of background tasks are stated unchanged.

## Temporary private A-share entry

`/ashare` and `/api/v1/ashare/{snapshot,status}` use normal public Eastmoney endpoints for an owner-only personal research view. No account credentials or user personal data are sent. Existing homepage/TIC behavior is preserved. This scoped private use is not a claim of general redistribution rights.

Validated A-share evidence is retained privately in primary D1 `ashare_snapshot_cache` (migration 0012), never bundled into source. The existing `ashare_source_gate` retains exclusive whole-acquisition ownership and permanent denial metadata. Snapshot writes, bounded pruning and successful lease release are one D1 transaction; a failed/uncertain transaction is never retried or silently released. Cold reads join gate permission and snapshot, revalidate every row/scope/count, and preserve original acquisition time. Freshness is 60 seconds; maximum serve age is 24 hours measured from acquisition and commit (whichever is older). Storage is bounded to 32 scopes and 2 MB per scope, with industry ranking retained ahead of stock scopes. Physical expiry cleanup is lazy on successful commits. No cached rows or 304 are returned after a known denial, unknown outcome, active lease, or unavailable permission check. No reset/takeover, extra provider retry, alternative endpoint, fabricated rows, source-date inference, or wider access is introduced.

The first-level industry query is based on Eastmoney's own published level metadata. An independent limited Python execution verified 31 first-level industries and one complete 523-stock/6-page scope. This is not a claim that every industry was sampled. The deployed JS path still requires actual runtime verification. Provider order-classified main-net values are labeled as estimates, not actual market money creation. Source observation time/trading date/latency remain unknown; acquisition time is separate.

The frontend checks every minute; acquisition is on demand with bounded cache/coordination, not a permanent background process. Every page is validated before publication. Source permission denial/challenges stop acquisition persistently; last-good values are explicitly stale. No custom fetcher, `isolatedForTests`, credential or proxy override is configured in the production host adapter.
