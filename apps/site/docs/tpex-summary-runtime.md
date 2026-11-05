# TPEx monetary summary runtime

The new `/api/v1/taiwan/tpex/summary/{snapshot,status}` routes describe the
licensed daily OTC institutional monetary trading subset. This is not total
Taiwan capital flow, a realtime feed, or an industry allocation.

## Current availability and provider prerequisite

The existing deployed TPEx provider gate was reported blocked after
`redirect_denied` during this implementation. This change does not enable live
collection, reset that gate, or treat a successful request from another runtime
as proof of hosted availability. All implementation verification uses synthetic
fixtures with external networking disabled.

The original `tpex_source_gate` row `institutional_shares` is authoritative.
Every request checks it before using cache, after admission before source I/O, and
again before returning evidence. Atomic D1 admission also requires its
state to be `idle` and its valid nonnegative integer `not_before_ms` to have
elapsed. Blocked states suppress cache and return denied. Busy, missing, unknown,
invalid-deadline and cooldown states fail closed without a source request.
Denied takes priority over busy or uncertain states. No automatic reset or lease
takeover exists.

The new `tpex_summary_gate` stores the independent summary cache and acquisition
lease. A new summary denial permanently blocks that gate only. It does not alter
or reset the original provider gate. This asymmetry is deliberate for the
current offline-capable stage; a future provider-wide bidirectional stop would
require a separate reviewed coordination change before enabling new collection.

## Runtime boundaries

`lib/reports` owns bounded JSON transport, request lifetime retention, cache
freshness, and D1 coordination. Dataset-specific parsing, schemas, URL and age
policy remain in `lib/national`. Production requires registered `waitUntil`;
uncertain writes remain retained and cannot be retried or taken over. The only
outbound request is one fixed official HTTPS endpoint with redirects disabled,
no credentials, and no fallback route. Access denial, redirects and HTML stop
collection durably. Refresh is hourly on demand; report age and cache age are
reported separately, and old daily reports never become realtime observations.

Migration `0016_tpex_summary_gate.sql` adds only the new gate, preserving existing
provider state and seeding blocked when the original gate is already blocked.
Run `npm run test:tpex-summary-runtime` for isolated native workerd/D1 checks.

## Concurrent provider transitions

After admission settles, the authoritative provider is rechecked before any
source request. This closes the delayed-admission race while retaining the
summary's own owned busy lease. The original provider row is never changed.

The summary finish statement atomically rechecks provider eligibility while
settling the owned lease. A blocked provider blocks the summary; any ineligible
provider clears the candidate instead of publishing it. A confirmed publication
receipt distinguishes rejected evidence from an uncertain database write, so a
settled lease is never retried. A final authoritative read suppresses evidence
if the provider changes after publication. Publication and the final read are
linearization points, not a claim that a separate provider row can never change
after the read. No original provider row is written by this runtime.

The native race suite injects blocked, busy, cooldown, missing and invalid
provider state after admission, during synthetic fetch, before publication and
after publication. It verifies zero source calls after revoked admission, no
persisted candidate when the atomic finish rejects it, one settled release, and
no returned evidence after any of these transitions.
