# TIC shared source protection and browser lifecycle

## Findings and boundaries

Offline audit reproductions showed that the Treasury current-month and rolling
history caches could request the same source independently after one cache saw
a refusal. HTTP 403/429/302 fell back to the ordinary five-minute cache retry,
and a one-hour HTTP 503 Retry-After was shortened to five minutes. The server
already used manual redirects and did not follow the rejected redirect.

Both browser views ignored refusal and Retry-After metadata, polled while
hidden, and relied on AbortController alone. Synthetic transports that ignored
abort could overlap a later request. These reproductions did not contact the
real Treasury source and do not establish that the native transport was hung.

## Changes

- A reserved metadata row in the existing TIC cache table atomically coordinates
  both cache keys across workers. There is no schema migration or gate reset.
- Explicit denial, redirects and access challenges persist. Busy and uncertain
  outcomes never expire automatically. Existing legacy refusal, failed transport
  or unknown retry metadata cannot silently initialize an open gate.
- A temporary HTTP response waits at least five minutes. Longer Retry-After
  values remain intact; absolute dates are compared with the database clock,
  not converted using a potentially skewed application clock.
- An abort-ignoring fetch/body has a bounded wait and leaves a persistent
  uncertain stop. Rejected transport, ambiguous writes and zero-row publication
  cannot open a new acquisition. Late responses do not publish.
- Validated current/history snapshots remain separately cached and can be read
  as stale with explicit source status. Source refusal is not presented as a
  recovered connection. Monthly data, signed amounts and source timestamps are
  unchanged.
- Browser polling is visible-only and serialized. Manual refresh obeys the same
  pause. Refusal, redirects and uncertain outcomes stop the active lifecycle.
  A status request finishing while hidden defers its snapshot read until the
  page returns, without repeating the status acquisition. Unmount cancels work.

## Verification

The final integrated baseline includes the prior Brazil CVM browser fix.

- 128 test files / 2,110 tests passed, including 29 real-SQLite synthetic source
  gate cases and current/history lifecycle and route-metadata regressions.
- TypeScript, whole-application ESLint and production build passed.
- Build verification covered 62 client assets, 51 Vite entries and bootstrap.
- Both offline built-asset regression checks passed.
- Five native workerd/D1 scenarios passed: HTTP 403/429/302 persist across two
  workers and both cache keys, a one-hour cooldown is retained, and validated
  snapshots/ETags survive with honest stale metadata after denial.
- Independent review identified and rechecked transport uncertainty, caller
  clock skew, zero-row writes, legacy error seeding, browser 429, and the
  hidden-status race. All reported findings were addressed.

The native runtime harness intercepts all outbound requests, accepts only the
fixed Treasury URL, and returns synthetic content. No production API/browser,
authentication, actual source, captured financial observations, or production
database was used. No access boundary was changed. These tests establish code
behavior and display contracts, not live Treasury availability.

An initial run of build, lint, typecheck and tests in parallel exhausted the
local process memory limit; the final checks were rerun sequentially and passed.
