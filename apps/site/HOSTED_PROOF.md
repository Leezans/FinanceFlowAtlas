# Hosted application: independent TIC layer

This deployment proof preserves the Vinext Sites starter's worker, connector integration, authentication boundary, and hosting manifest. It does not replace the Python monorepo architecture. No secrets, upload route, writer API, seed observations, captured source data, or scheduler are included.

## Frontend

The existing IMF + TIC React interface is rendered by `app/page.tsx`. TIC is the default. The IMF layer is explicitly unavailable in this hosted proof; its status endpoint says so and its snapshot endpoint returns 503. Foreign exchange, futures and crypto remain unconnected. Geography uses the bundled attributed Natural Earth polygons and ISO index.

TIC currently targets the **fixed, previously verified 2026-08 month**, not an automatically inferred latest release. The UI states this. The foreign country indicates reported residence; the security issuer economy remains the United States even for negative transactions. Monthly net transactions are never mixed with IMF holdings, approximated from holdings differences, or presented as real-time flows. Industry/individual-security data are not supplied.

## Server routes and D1

- GET `/api/v1/flows/tic/status` and GET `/api/v1/flows/tic` both read through the cache, so the initial status request can obtain the first verified snapshot.
- Direct HTTPS source: `https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt`. No connector, keys, third-party proxy or arbitrary target is used. Redirects are rejected. Download limit 10 MB; fetch deadline 12 seconds.
- The TypeScript port of the reviewed Python parser checks title, millions-of-dollars source units, machine header, footer, explicit Treasury country-code/name mappings, duplicate rows, numeric precision, period and official grand total. Zod validates the saved and returned snapshot. Unknown revision-publication time stays null. Raw SHA-256 and deterministic snapshot identity are retained.
- D1 binding `DB`, table `tic_snapshot_cache`; one key for the fixed month. Only validated public snapshot JSON, version, check times, errors and a short concurrency lease are stored. No user identity data.
- Successful source checks are reused for 24 hours. Failure checks back off five minutes. A 30-second token lease avoids concurrent upstream work and prevents old requests overwriting a newer result.
- Failed refresh preserves the last-good snapshot with stale status. Initial absence returns 503 with no substitute data. The snapshot ETag includes source-check state so stale transitions invalidate client 304 caches.
- Checks occur only on user/read requests. No background schedule or external writer endpoint is created.

## Checks

Run `npm test` (or `npx vitest run --config vitest.config.ts`) for synthetic adapter/cache/UI tests. No financial fixture is imported into production code. Run `npx tsc --noEmit`, then use the supported Sites build/preview/publication workflow. `npm run db:generate` creates the D1 migration; the operator applies local migration and publishes via supported Sites tooling. Source and authentication publication choices remain with the operator.

## Country treemap review increment

The primary TIC visualization is now a grouped rectangular treemap, with a geographic-map tab. It uses d3-hierarchy squarify, grouping the actual reported foreign-residence rows by the geographic index's region. Region headers and country tiles support drilldown, with a breadcrumb back to the complete reported-country view. This is not an industry or individual-stock hierarchy.

Tile weight is the absolute signed monthly net transaction amount. Its denominator is only the sum of absolute net amounts of the included reported country rows; it is neither market capitalization, gross purchases/sales, nor the Treasury Grand Total. Negative amounts retain their original identity and sign. Reported zero rows appear separately with no positive-area tile; missing rows receive no area and an unavailable denominator is shown as a dash. The China/global palette toggle changes color conventions only. Keyboard labels and single-string SVG titles provide full values where tiles are too small for labels. Responsive layout recomputes rectangles rather than shrinking a desktop image.
