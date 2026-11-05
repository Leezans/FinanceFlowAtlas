# Shared Kraken snapshot cache: offline verification

## Change

Cold isolates now read the same validated Kraken quote/trade acquisition cohort
as the worker that collected it, including the fiat FX selection. The existing
single source gate remains authoritative. No source endpoint, scope, credential,
permission, polling frequency or redistribution boundary is expanded.

- `contract.ts`: transport-independent public types, limits and known
  pre-publication validation-error contract.
- `validation.ts`: common browser/server response schema, extracted unchanged.
- `snapshot.ts`: strict persisted quote/catalog/trade validation and byte budget.
- `snapshot-store.ts`: primary-D1 permission/evidence reads, immutable bundles,
  canonical references and owner-token atomic publication/release.
- `shared-reply.ts`: status/response formatting without rewriting observation,
  acquisition or trade-window timestamps.

Canonical selected-pair + timeframe references preserve coherent quote/trade
cohorts. Missing cohorts can fall back to latest validated quotes without trades
from a different selection. The latest and selected references deduplicate one
bundle. Retention is capped at 16 selections plus latest, at most 17 bundles of
2 MB each. Original fetched time controls the unchanged 15-minute display expiry.
Expired references and orphaned bundles are pruned during successful publication.

Busy, denied, corrupt or unreadable shared state exposes no evidence. Status
reads never fetch a provider. Cold workers do not invent last-attempt metadata.
Known input-validation failures release their exact owner once; uncertain
submitted transactions remain retained and fail-closed without blind retry.

## Verification on final source

- `npm test -- --maxWorkers=2`: **99 files, 1,554 tests passed**.
- Included independent cache/handler suites: **55 tests passed**, covering
  transactional rollback at every statement, stale tokens, lease permission
  races, schema/byte/identity corruption, bounded retention, original clocks,
  expiry, selected fallback isolation, cancellation and late retained commits.
- `npm run test:kraken-runtime`: **15 native workerd/D1 scenarios passed** with
  every external connection disabled. Includes separate warm/cold/fresh isolates,
  plain/gzip/Brotli, 703-pair catalogs, crypto 1m and fiat FX 5m cohorts, denial,
  Retry-After, capped trades, cancellation, expiry and corrupt persisted evidence.
- `npm run lint`: passed, no ESLint warnings.
- `npx tsc --noEmit`: passed.
- `NODE_OPTIONS=--max-old-space-size=2048 npm run build`: passed.
- All **18 migrations (0000–0017)** applied to a new SQLite database with foreign
  keys enabled; foreign-key check clean. Schema generation reports no drift.
- Independent review: one pre-publication cleanup edge was fixed and regression
  tested; final focused review found no remaining blockers.

Two unrestricted aggregate attempts were killed by the environment (exit 137).
The complete final run passed with bounded test parallelism. This is not a source
or application test failure.

## Integration and limits

Base source tree: `d1e800deb59844aeb68b5887a34984cdf31fdfd8`, matching GitHub main
`6c3340fd505061e062a83ad52ba12e432fab8140` (local equivalent `3a0dc8ce`). The prior
coordination/backoff fix is retained.

Apply appended `0017_kraken_shared_snapshots.sql` after existing migrations via
the supported deployment workflow before deploying the new host. It creates only
two cache tables; it does not reset or alter source gate rows. Missing migration
fails closed before source admission. Deployment and authenticated live source
verification are separate from this local handoff.

No real provider request, captured market observation, private account data or
credential was used in these checks. Quote source-observation time and latency
remain unknown. A one-minute check is not a promise of real-time source data.
No visual layout was changed; existing crypto/FX component tests passed. A new
browser screenshot/production visual check was not performed for this backend
change.
