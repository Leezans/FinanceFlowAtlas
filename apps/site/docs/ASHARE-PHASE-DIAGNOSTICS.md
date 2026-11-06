# A-share acquisition phase diagnostics

These diagnostics are metadata only. They do not change the source, requests,
20-second acquisition deadline, pacing, refusal checks, gate ownership, cache
publication or backoff. No migration or production gate update is required.

## Events and privacy

`[ashare phases]` emits one `acquisition_finished` event after a retained
acquisition settles and an `acquisition_deadline` event when the existing timer
fires. There is no per-chunk or additional per-page logging. An unsettled fetch
or database operation has no finished event; the deadline is not proof that the
operation settled, failed or released its lease. A late observed denial still
wins over the deadline.

Fields are fixed application phase/result/route enums, elapsed milliseconds,
the last requested page, the number of source requests and fully validated pages
in this invocation, and cumulative phase timings. Counters are bounded. The
last requested page does not identify a pending next page during pacing. The
route is only `primary` or `official_redirect`, never a URL. No source values,
row/industry/user identities, URLs, query parameters, credentials, leases,
response headers/bodies or exception text are added. Existing platform request
correlation is used rather than generating an app identifier. Invalid clock
readings remain null; timings are not control inputs. New log sink failures are
ignored and cannot alter source or gate behavior.

Phases distinguish initial cache read, queue, preflight, cache recheck, gate
admission, admission wait, stage read, source pacing, fetch waiting for response
headers, response validation, body read, body cleanup, page validation,
publication check, snapshot commit, stage save/discard, gate release and denial
cleanup. The current phase at the deadline and the failure phase are separate: a
late denial or an unconfirmed cleanup can supersede an earlier timeout.

`failed_phase` retains where an error was observed before cleanup; an unconfirmed
storage/release error replaces it. Cumulative phase timings include all visits
to a phase; `phase_elapsed_ms` is only the current visit. Initial cache time
includes synchronous handler preflight and is part of the existing total budget.
Status reads, fresh-cache hits and other requests that never start a retained
acquisition emit no new acquisition event. Trace state is ephemeral, not stored.

## Interpretation limits

`source_headers` means the application's fetch promise has not returned a
Response. It cannot distinguish DNS, TCP, TLS, provider processing or network
delivery. `source_body` does not establish why body delivery is slow. No prior
incident can be retrospectively diagnosed from instrumentation added later.
Zero fully validated pages does not mean zero bytes received. Validated pages
are not published partial evidence. Success is recorded only on the original
confirmed publication or durable staging paths.

The read-only diagnostics endpoint separately projects retained failure time,
category and capped count from existing metadata, as documented in
[retained failure diagnostics](ashare-retained-failure-diagnostics.md).

## Offline verification

The synthetic phase tests cover redirect pacing plus a stalled redirected fetch,
stalled bodies, queued deadlines, unsettled atomic commits, late denials,
privacy sentinels, invalid clocks and throwing diagnostic sinks. Existing tests
continue checking the 20-second deadline, request counts/pacing, staged
publication, cancellation and exactly-once gate release. None of these tests
establish live source availability.
