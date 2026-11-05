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
ephemeral; the database stores only acquisition metadata.

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
