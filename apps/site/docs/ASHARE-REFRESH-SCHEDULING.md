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
  per staged invocation.
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
