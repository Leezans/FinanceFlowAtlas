# A-share acquisition refresh scheduling

The A-share cache remains fresh for 60 seconds from its oldest collected page.
That is an acquisition-age limit, not a claim about the underlying market
observation: `source_observed_at` and `trade_date` remain unknown.

## Fixed interval failure

A browser interval measured from page mount can run slightly before the server's
first acquisition reaches 60 seconds. Database admission and reads happen after
mount. That check reuses the still-valid snapshot, and the next fixed interval
would not check again until roughly 120 seconds. A regression test uses 200ms
store reads to reproduce this without provider access or shortened timeouts.

## Relative cache-check contract

Successful snapshot responses (200 and 304) without a recovery diagnostic include
`X-Ashare-Refresh-After`, an integer number of seconds from 1 through 60. The
handler derives it from the server's existing oldest-page age and rounds upward.
An already-stale completed acquisition requests another normal check promptly;
it does not become fresh merely because the application read it again.

This header is outside the evidence payload and ETag. It does not change source
timestamps, freshness classification, bytes, or trading-session interpretation.
It is not provider permission. Every later request still passes ordinary cache
validation and shared source admission.

The browser keeps one cancellable timer and one active request for the selected
scope. Valid healthy-cache hints schedule the next check, using a relative delay
rather than subtracting source timestamps from the device clock. For
`collection_in_progress`, the existing `Retry-After` continuation has priority.
Other temporary failures keep minute checks and must satisfy their full cooldown.
A stopped response ends scheduling. Missing or invalid hints fall back to the
existing minute check. Navigation and unmount cancel the timer and transport and
invalidate older completions.

## Unchanged source safety

- At least 3 seconds between source request starts, including redirects.
- The same shared lease, successful quiet interval, and failure cooldown.
- A 20-second invocation acquisition budget and at most three validated pages
  per staged invocation. A staged invocation yields earlier when its remaining
  budget cannot fit the last validated page's measured duration plus a 1-second
  disposal reserve (with the existing 6-second minimum margin). This is a
  conservative local estimate, not a source latency guarantee or extra timeout.
- Serial page collection, stable provider-code order, full-count validation,
  bounded total acquisition age, and atomic complete publication.
- Denials stop acquisition; uncertain storage outcomes do not release ownership
  or authorize retries.
- No background collector, parallel provider acquisition, gate reset, partial
  denominator, or fabricated market timestamp.

## Validation

The handler/React regression proves the next source acquisition happens by 62
seconds with the 200ms-store fixture, while the old UI skips that acquisition.
Tests also cover 304 hints, unrelated device/source clocks, malformed hints,
recovery precedence, in-flight deduplication, scope changes, and unmount.

The offline native workerd/transactional-D1 test traverses 512 synthetic stocks
in six pages with one official redirect, follows only the endpoint's ordinary
continuation hint, and verifies pacing and atomic publication. A measured run
completed in 18.395 seconds and returned a 42-second next-check hint. This is a
synthetic native-runtime result, not a live latency guarantee. Live source
response time, rate limits, temporary failures and browser suspension can still
delay completion. A large staged traversal need not be an atomic market snapshot
or finish inside one minute.

## Browser connection and response-body limits

The browser waits at most 35 seconds for one application snapshot request,
including its response body. The server's 20-second acquisition budget, shared
source gate, and durable cooldown are unchanged. A request or body that never
settles previously left the browser's in-flight flag set forever, disabling
all later automatic refreshes. The browser now aborts that request, shows an
application-timeout diagnostic and keeps only the selected scope's previously
validated evidence with its original ETag and acquisition time.

A browser timeout cannot establish whether the provider failed, succeeded, or
remains busy. The next ordinary application check waits at least 60 seconds
after timeout and honors any longer Retry-After already received in the response
headers. The authoritative server gate still decides whether collection is
permitted; no source lock, denial record or cooldown is changed by this fix.

Known 401/403 responses and stopped recovery headers clear evidence immediately,
without waiting for a response body. Navigation/unmount abort the old wait and
cancel its timeout; late headers/bodies cannot publish old-scope evidence.
Healthy responses and 304s still use their server-relative cache-check hint.
Regression tests use synthetic fetch and body stalls with no provider networking;
they do not establish live source availability.

## Access-driven operation and resuming a page

This deployment does not run an unattended A-share collector. A snapshot GET
may start collection after ordinary server admission; the status endpoint only
reads state. The status contract now says `collection_trigger: snapshot_request`
and `background_collection: false`. The normal 60-second value describes the
open page's target check interval, not a production scheduling service or a
market-observation guarantee. No new request is scheduled after page unmount;
already-started server work can still finish its bounded cleanup.

The browser now catches up an overdue check on visible-page focus, pageshow
(including back/forward-cache restoration), or visibilitychange. It does not
refresh before its previously scheduled deadline. The same client cooldown and
stopped state remain authoritative, and the existing in-flight guard prevents
focus/visibility bursts from overlapping requests. Event listeners and the timer
are removed on scope change/unmount. Browser throttling/suspension and provider
failures can still prevent a complete fresh observation every minute.

## Unattended scheduling remains unconfigured

The deployed Worker exports fetch, not scheduled, and its generated configuration
has no cron triggers. No Site-linked automation was present when this behavior
was reviewed. The supported Sites publication tools available during this change
did not expose a verified native cron configuration/readback path. Adding a local
scheduled function or a cron string alone would not prove a production scheduler
was installed. No shell loop, assistant task or repeatedly open browser was used
as a substitute collector.

Cloudflare's [Cron Trigger documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
requires both a scheduled handler and an installed trigger. Before claiming
unattended minute collection here, a supported hosting path must install and read
back that trigger, verify unattended access and actual executions with the page
closed, and reuse the same durable source gate, serial paging, complete-snapshot
publication, denial stop and retained retry cooldown. It must never reset a busy,
unknown or denied source outcome. Scheduling a check does not establish that the
provider publishes new data every minute, during trading or outside it.

## Finite acquisition batches are separate from minute checks

A naive caller that makes exactly one snapshot request per minute is insufficient
for larger lists. Each invocation validates at most three pages, and the private
stage expires 180 seconds after its original start. An offline 901-row / ten-page
counterexample reaches pages 1–9 at 0, 60 and 120 seconds, then restarts page 1 at
180 seconds. Repeating the same minute tick never publishes that acquisition.
This is a synthetic capacity counterexample, not a claim about the size of a live
industry. The page already followed continuation hints before this change.

`lib/ashare/collection-batch.ts` now separates finite continuation from the outer
refresh cadence. The page uses its controller; `runCollectionBatch` exposes the
same policy for a future supported job adapter. It does not choose an endpoint,
provide authentication, register a schedule, or call an upstream directly. The
adapter must supply one already-authorized ordinary snapshot request and pass
its result through the same evidence validation and strict continuation parsing.
The existing `consumeReply` function provides that validated result shape.

Only an unambiguous `collection_in_progress` result with a valid Retry-After can
continue. 503 with no snapshot, validated stale 200, and 304 with matching cache
are supported. Unknown/conflicting error codes, stop flags, malformed/missing
Retry-After, invalid evidence and a new 200 body's error flag cannot authorize a
fast continuation. A historical 304 body is not mistaken for a new error report.
Every other result ends the batch, including busy, cooldown, transport failure,
denial and uncertain results. Ordinary UI recovery retains its existing cadence
and complete server cooldown; stopped states still prohibit retry.

One cycle includes its first request and permits at most 20 requests, because a
slow invocation may validate only one page. Its original 180-second window is
never renewed by partial progress or manual retry. No further request starts
without enough remaining time for the unchanged 20-second server budget. The
page and finite driver cap the application wait by the remaining window and the
35-second per-request limit. Late responses cannot authorize another request;
these client limits do not establish the server's outcome or release its lease.
Timer wakes recheck the deadline, and early wakes do not shorten Retry-After.
Navigation/unmount cancel the page transport and timer. An exhausted page batch
returns to the ordinary minute check instead of immediately creating a new batch.
A suspended browser can deliver its cancellation late; the server's own stage
expiry and source gate remain authoritative throughout.

The client's local window cannot prove that an existing durable stage has a full
180 seconds left. Source-side expiry, stable ordering/count checks, maximum rows,
original start time and atomic complete publication are unchanged. No stage TTL,
source request spacing, successful quiet interval or failure cooldown was raised
or lowered. A completed multi-page acquisition may already be stale; its original
source-observation and trading timestamps remain unknown.

Validation includes the failing minute-caller counterexample, successful finite
901-row and 2,000-row acquisitions, and ten slow one-page invocations within the
original window. Native offline workerd/D1 tests exercise the same finite driver
across independent workers. All source responses are synthetic and external
networking is disabled. This is not a deployed unattended scheduler or proof of
live market-data availability. A future job still needs supported scheduling,
authorized service access, durable job ownership, fairness and no-visitor tests.


## Optional independently deployed Worker

The repository now includes a default-disabled [scheduled Worker adapter](../scheduler/README.md).
It reuses this finite driver and the existing handler/gates in native Workers,
with separate durable job ownership, minute idempotency, bounded scope fairness
and read-only gap checks. It has no installed trigger, account binding or public
endpoint. The current Site remains request-driven. Enabling a separate same-D1
deployment and verifying real no-visitor executions remain operator steps, not
accomplishments of this source change. No Node/VPS cookie-based caller is provided.


## Application rate limits and conflicting diagnostics

HTTP 429 clears browser evidence as before, but now retains the full Retry-After
wait for both automatic and manual checks. Numeric seconds and HTTP dates use
the existing parser; missing or malformed values use the ordinary one-minute
fallback. A headerless gateway response is labeled an application rate limit,
not proof of a provider failure. It cannot authorize fast collection continuation.
Known stopped diagnostics in either the header or JSON body take precedence over
a retryable diagnostic in the other location. The page clears evidence and stops
rather than silently replacing an unconfirmed or denied outcome with a cooldown.
Synthetic client and browser tests cover these paths without accessing a source.
No server admission, persistence, lease, scheduled job or provider policy changes.

## Slow-page deadline regression

A fixed 6-second yield margin could start a second 11-second page with only
9 seconds remaining, then lose the first validated page when the 20-second
acquisition deadline fired. The conservative page-duration check saves that
validated stage before starting another source request. Offline finite-driver
tests now cover 901 rows at 11-second page latency (10 invocations) and
6.5-second page latency (5 invocations), alongside existing zero/14-second
fixtures. All retain strict complete publication, pacing, stage expiry and
shared admission. A later page can still be slower than the estimate, and
stalled first pages still stop at the original deadline. These synthetic
results do not establish live provider availability.
