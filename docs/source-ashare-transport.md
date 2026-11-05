# A-share source transport

The hosted `/ashare` view retrieves public Eastmoney industry and constituent
order-flow fields through bounded Cloudflare Workers native fetch. It needs no
Tushare account, source login, user identity, or API key. The source fields are
provider order-classified estimates, not market-wide newly created money.

## Native content decoding

Cloudflare's [Fetch documentation](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
describes automatic gzip/Brotli negotiation and decoding when the response body
is read. `Content-Encoding` can remain present on the decoded response. The
adapter therefore accepts an absent/identity, single gzip, or single br coding
and reads the native decoded stream. It does not decode the body a second time.
Unknown or chained encodings remain unsupported.

The four-megabyte acquisition budget counts **decoded** bytes across all pages
and the permitted official redirect, including responses with a smaller encoded
Content-Length. A declared length larger than the remaining budget is also
rejected. The existing request deadline, page/row limits, exact-target redirect
validation, unique IDs, stable totals, complete pagination, strict numeric
validation, and duplicate-key JSON rejection remain in force.

No new source host, proxy, account, retry route, or access method is introduced.
HTTP denials, challenges, and off-policy redirects still stop source acquisition
persistently. No denial gate is cleared by this change. Source payloads remain
shared privately through the bounded primary-D1 cache described below; the source gate still stores acquisition metadata only.

## Diagnostics and verification

Failed acquisitions emit only an allowlisted `error_code` and scope kind in
production logs. The error API and client use bounded local explanations rather
than exposing provider bodies, exception strings, URLs, or credentials. This
allows a missing migration, busy coordination, unsupported encoding, malformed
source data, timeout, and source denial to be distinguished without loosening
validation or manufacturing a fallback snapshot.

Synthetic tests cover runtime-decoded gzip/br responses, the decoded byte limit
with a small encoded length, unsupported/chained encodings, and raw compressed
bytes that were not decoded by the runtime. These tests establish adapter
behavior, not live availability. A successful real production snapshot and
constituent drilldown must still be observed through the authenticated private
Site before claiming that the production source is working.

## Scope-specific quote units

Eastmoney's [board-index explanation](https://baike.eastmoney.com/item/%E6%9D%BF%E5%9D%97%E6%8C%87%E6%95%B0)
describes an index as a point level rather than a currency amount. `f2` is the
current quote of the requested object: an industry board
index level in an industry-rank response, or a stock price in a constituent
response. It is not a currency amount merely because `f62` in the same row is
CNY. Snapshot metadata now declares `field_units.f2 = index_points` for
`industry_rank`, and `CNY` for `industry_stocks`. `f62` remains CNY and `f3`
remains percent. No value is rescaled, and the monetary treemap still uses only
`f62`.

The visualization validates the combination of scope and quote unit, rejecting
old/mislabeled industry snapshots that claim a CNY index quote, stock snapshots
that claim index points, and unknown quote units. Source details also explain
the two meanings. Synthetic regression tests cover both valid scopes, incorrect
units in both directions, and null/missing quotes. This corrects the contract;
it does not establish the quote's observation time or live source availability.


### Deploying the unit correction

The cached acquisition stores raw rows and scope, not response `field_units`.
The response constructs corrected units each time, and its ETag covers those
units. A conditional request carrying the previous industry-CNY ETag therefore
receives HTTP 200 with corrected metadata and the same cached rows; subsequent
requests with the new ETag receive 304 without reacquiring the source.

Deploy the adapter and frontend validator together. An already-open browser
running the old strict validator does not accept `index_points` and must refresh
the page to load the updated client. Do not make the new validator accept the
incorrect old CNY industry label to hide a mixed-version deployment. Synthetic
regression coverage verifies this cache/ETag transition without live requests.

## Canceled request cleanup

The host registers each complete acquisition-and-release promise with Workers
`waitUntil` **before** it may acquire the D1 lease. It fails closed if registration
is missing or throws. This keeps an already-started operation's cleanup eligible
to run after the client leaves; it does not create periodic or unrelated
background acquisition.

The deployment explicitly enables `enable_request_signal`. For the deployed
2026-05-15 compatibility date, disconnect notifications are not enabled by
default. The incoming signal still aborts the source request and pagination;
retention covers the existing release operation. See Cloudflare's
[request-cancellation announcement](https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/)
and [Workers lifetime limits](https://developers.cloudflare.com/workers/platform/limits/).
The grace period is bounded by the runtime, so process crashes or unavailable D1
can still leave an uncertain lease. No code expires, resets, steals, or releases
another acquisition's token.

Offline native-workerd coverage returns an early HTTP response, aborts the
synthetic request signal, then verifies that the actual D1 lease is released with
the temporary-failure cooldown and that another isolate cannot acquire early.
The test uses mocked provider responses with real network access disabled. It
proves post-response cleanup retention, not production source availability or
end-to-end socket-disconnect propagation through the Sites platform.

An already-interrupted production operation remains uncertain until separately
reconciled by an authorized operator. Deploying this prevention fix never clears
an existing busy or denied gate.

## Observed denials take priority over body disposal

HTTP denials, HTML/non-JSON challenges, and rejected redirects are classified as
soon as their response metadata is observed. The handler first attempts its
single, token-matched durable denial write. Only after that write settles does
it dispose of the denied response body, with a one-second maximum wait. A
body-cancellation promise that hangs or rejects cannot postpone recording the
denial or turn it into an ordinary retryable failure. Failed/uncertain persistence
still stops local acquisition and never reopens the shared gate.

Regression tests include permanently pending stream cancellation, failures of
both persistence and cleanup, cross-isolate refusal before disposal completes,
and automatic-redirect/cancellation races. An offline native-workerd test uses
an actual stream and D1 table to verify that the denial is durable despite stalled
body disposal. Production state is not modified by these tests or the fix.


## Unconfirmed acquisition status

A `busy` operation older than three minutes is now reported as
`source_outcome_unconfirmed`, rather than promising that another collection is
still running. The threshold is diagnostic only: it covers the 90-second
acquisition budget plus cleanup margin but proves neither that the process died
nor what response the provider returned. A recorded denial always takes priority.
The D1 row, token, timestamps and reason remain unchanged. No expiry, release,
takeover, source retry or source switch is introduced.

The API responds with `X-Ashare-Recovery: stopped`, with no `Retry-After`. The
handler stops further admission in the same isolate; the browser stops automatic
checks and removes the retry button. A-share's empty matrix states that the prior
result needs review, instead of implying that waiting will recover observations.
Missing or inconsistent acquisition metadata fails closed. Recovery still needs
verified evidence of the prior request's outcome and an authorized reconciliation;
age and `reason_code = null` do not establish a safe retry.

Unit tests cover the exact age boundary, missing/future metadata, unchanged lease
ownership, denial precedence, API/client stop behavior and truthful empty UI.
An offline workerd test seeds only a synthetic legacy busy row and verifies that
all fields are byte-for-byte unchanged across two isolates with zero source calls.
This fixes diagnosis and retry behavior, not the availability of current A-share
observations, and must not be described as restored source data.

## One-time operational reconciliation, 2026-11-05

The 05:36:32 UTC invocation was reported as terminal `canceled` after about 1.6
seconds. Its provider response was not retained. D1 preserved the original busy
lease acquired at 05:36:31.992 UTC, without a recorded denial. The missing outcome
must remain **unknown**, not be described as success or proof that no response
occurred. No source denial, challenge, rate limit, access-policy change, or denied
administrative reset is established for this invocation.

The user's repair request authorizes a deliberate service repair, not provider
restriction bypass. Migration `0010_ashare_legacy_reconciliation` is that explicit
one-time operation. It only matches the exact legacy token and every known field
of the unchanged row, never a blocked row, different owner, newer acquisition or
changed cooldown. A database trigger atomically preserves the full old row and
this limited evidence in `ashare_recovery_audit` before releasing it. An audit
write failure leaves the gate unchanged. The repair imposes a fresh 60-second
quiet period. The old `acquired_ms` remains as evidence. The trigger is removed;
replay is a no-op. It is not an automatic timeout, generic reset endpoint, or
permission to retry after a source denial. Future crashed/unknown operations
still require separate investigation. All current provider-denial behavior
remains in force, and any denial on the next authorized acquisition remains
permanently recorded and stops requests.

The runtime now logs only bounded lifecycle metadata: admission, each source
request's page number, response HTTP status, and confirmed release outcome.
Tokens, request identities, source URLs, payloads and financial values are not
logged. Normal unsupported-encoding and oversized-body cancellation is bounded
as well as denied-response cleanup, so a stalled stream disposal cannot hold an
otherwise classified operation forever.

SQLite and network-disabled native-workerd tests cover exact reconciliation,
atomic audit failure, migration replay/interruption, newer owners, changed
metadata, persistent denial, cooldown and cold-start collection. They do not
establish real source availability. After deployment, read the audit and gate,
wait for the shared cooldown, and verify one real industry snapshot and one
constituent snapshot. Stop if the live source denies access. No financial rows
are persisted by this repair; last-good snapshots remain isolate-local, so cold
starts must reacquire rather than imply a durable last-good cache exists.


The status endpoint also reads the shared gate without acquiring a lease or
contacting the provider. This fixes the cold-isolate `has_error=false` response
that previously hid a persistent busy/denied state. Status inspection has a
two-second bound, reports storage failure truthfully, and never changes the gate.


## Durable validated A-share snapshots (migration 0012)

`snapshot.ts` owns the shared scope, row, complete-snapshot and byte validation.
`snapshot-store.ts` owns primary-D1 reading and atomic publication; the existing
source gate remains the sole admission authority. The handler owns request
lifetime, source transport and responses. There is no second scheduler or gate.

- One complete last-good version per scope. Industry ranking is retained ahead
  of stock scopes; at most 32 scopes, 2 MB per snapshot, 64 MB payload total.
- Fresh for 60 seconds. After a temporary failure, a cold worker may return
  validated stale evidence for at most 24 hours from acquisition/commit,
  whichever is older. Reads never renew timestamps or the expiry deadline.
  Expired records are not served and are physically pruned on the next success.
- Success transaction: owner-guarded snapshot upsert, expired-row deletion,
  bounded scope pruning, then the existing 3-second quiet interval and lease
  release. D1 rolls back the entire batch on failure. All statements require the
  same current lease token; a stale token changes nothing.
- A single joined read verifies gate state and snapshot. Busy, uncertain,
  denied, malformed, missing-schema and unreadable state cannot expose rows.
  A final metadata check after ETag calculation also suppresses evidence if a
  denial/active operation was recorded while hashing. These checks never acquire,
  reset, expire, release or bypass an operation.
- Queued requests reread the shared cache before admission and after the one
  bounded cooldown wait, avoiding a duplicate fetch when another isolate has
  already committed fresh evidence.
- `fetched_at` remains the actual acquisition timestamp. `source_observed_at`
  and `trade_date` remain null. Commit time governs storage retention, not market
  freshness or a claim about when the provider observed a trade.
- Migration 0012 only adds the cache table. It does not seed observations, mutate
  any gate, apply the legacy reconciliation again, or grant display permission.

The native suites use synthetic interceptors with external networking disabled.
They prove runtime behavior, not current provider availability. Deployment still
requires authorized migration/release and a real permitted source acquisition;
an empty cache cannot manufacture the first real snapshot.


## Recurrence prevention: fit the retained runtime budget

Production invocation `a51dcec4e7ce88a5c73ed04f4d3a8112` acquired its lease at
2026-11-05 09:35:00.854 UTC. The primary request returned HTTP 302 at
09:35:21.652, and the existing strict redirect path then started a second
request. At 09:35:29.146 the invocation ended as `canceled` after 31.504 seconds,
without a logged second response or durable release. The same trace explicitly
logged: `waitUntil() tasks did not complete within the allowed time after
invocation end and have been cancelled.` This confirms the retained-work ceiling
terminated the operation while the old acquisition budget was 90 seconds. The exact host disconnect/signaling sequence
is not available. The redirected request's result remains unknown; this change
neither resets that lease nor claims that no denial occurred.

The handler now establishes **one 20-second absolute acquisition deadline at
entry**, including initial shared-cache reads, queue waiting, admission,
cooldown, every redirect and every page. The timer is created before joining the
queue. Neither collection nor redirects restart it. This leaves ordinary
native-abort work room for up to one second of stream disposal and a five-second
persistence reserve, plus scheduler slack before the observed runtime ceiling.
The five seconds is a reserve, not a promise that D1 always finishes that fast.

A deadline aborts the native fetch, but the handler still awaits its outcome.
It never races away a request and releases ownership while a late denial could
still arrive. Any observed denial wins over cancellation and is persisted before
body disposal. A confirmed late admission releases only its own token without
requesting the source. A deadline is checked again before issuing an atomic
snapshot commit. Once commit/release is issued it must settle; no timeout causes
a second release or guessed success. Unknown network or persistence outcomes
continue to fail closed. The current uncertain 09:35 lease stays unchanged.

This is a prevention fix for the observed budget mismatch, not a guarantee
against runtime loss, unresponsive cancellation, hung D1, or delayed timers.
A complete snapshot that takes more than 20 seconds is now rejected, never
partially published. With three-second pacing, the theoretical maximum is seven dispatches, or six data pages if one redirect is needed, before network/admission latency. Larger or slow paginations can therefore remain unavailable;
a prior valid snapshot may be shown only under the cache's existing permission,
expiry and explicit stale rules. Nothing here establishes real-time source
observations or an exact provider delay.

Added fake-timer tests cover the original deadline across reads, admission,
queue and redirect; delayed 403 priority; stalled body disposal; late admission;
and unsettled fetch/commit without a guessed release. Network-disabled native
workerd tests return an early response **without** relaying client cancellation,
then stall the primary request or an allowed redirect. They verify native abort
and a confirmed D1 release/cooldown before 27 seconds, with no partial cache and
no cold-isolate source retry. This tests the missing-signal case absent from the
previous explicit-abort test; it is not a live-source restoration proof.
