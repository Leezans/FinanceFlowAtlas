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
