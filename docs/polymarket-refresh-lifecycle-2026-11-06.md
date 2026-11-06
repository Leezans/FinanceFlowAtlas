# Polymarket browser refresh lifecycle audit

Reviewed against public main `3e63c08852da0beed8cd4980e9babb074c411f1a`
(private Site v60). The isolated working checkout started at public tree
`ba53e09b7de9a7a5517d8546dbd3ab69e24f9d43`.

## Reproduced defects

- A stalled browser fetch or response body that did not settle on abort left the
  page permanently loading. Its timeout only called AbortController.abort; it
  never independently ended the awaited operation. Later refreshes, including
  mode switches, could not acquire the browser's active slot.
- HTTP Retry-After was not read. A temporary gateway response requesting a longer
  pause could therefore be checked again after the local 30-second minimum.
  A body that stalled or failed JSON parsing also lost this header evidence.
- Server deadlines beyond the signed 32-bit timer limit were passed directly to
  setTimeout. Browsers clamp overflowing delays to an immediate timer, creating
  repeated local callbacks. The due-time check still prevented an early source
  request, but the local timer loop could consume substantial CPU.
- Permission/redirect handling covered only 401/403 before JSON. Other explicit
  access stops and manual opaque redirects could be left behind a stalled body
  or treated as retryable invalid responses.

The initial synthetic regression suite reproduced 10 failures in 15 cases on the
unmodified hook. The corrected implementation passed all 15, then passed 19 after
independent review requested four additional boundary scenarios.

## Correction

Race both browser fetch and body reads against the existing 20-second abort
signal. This releases logical browser work, reports a failed check and schedules
one successor after the complete minimum pause. A late fetch or body cannot
publish old evidence. This timeout does not assert a provider failure, settle a
source lease, reset a gate or establish the outcome of server-side work.

Capture Retry-After immediately on receiving headers and preserve its deadline
across all three modes, manual calls, visibility changes and body failure. Each
scheduled timer is capped at 2,147,483,647 ms; the original deadline is unchanged
and checked again when each chunk expires. Structured view-specific and shared
source deadlines retain their prior meaning.

Use manual redirects and stop on 401, 403, 407, 451, redirect responses and opaque
redirects before waiting for JSON. HTTP 429 is a temporary application response
whose Retry-After is honored. This does not change the provider transport's
existing treatment of provider denials, including its permanent 429 stop.

The existing single logical request, visible-page checks, per-mode evidence,
original cache expiry, stale marking and terminal source-denial behavior are
preserved. An admitted request may finish while the tab is hidden; no successor
starts until visible. This avoids claiming that cancellation proves provider
work stopped. A deliberately abort-ignoring transport can remain physically
pending after its logical timeout; native browser fetch normally honors abort.

## Verification

- 19 lifecycle regressions cover ignored-abort fetch/body recovery; late fetch
  and body responses; Retry-After seconds/date and invalid/hung bodies; 40-day
  deadlines across the real timer chunk boundary; permission and opaque-redirect
  stops; warm 429 cache expiry; hidden completion; repeated mode changes and
  clicks; and unmount cleanup.
- Independent review reran all 19 cases and found no blocker.
- Full hosted suite: 122 files / 1,959 tests passed. TypeScript, zero-warning
  ESLint, production build, 61 client assets across both RSC manifests / 50
  Vite entries / bootstrap, and both build-asset regressions passed.
- Offline Chrome with the real Polymarket component and synthetic-only responses:
  a hung body ended at 20 seconds; one automatic successor succeeded at 50
  seconds; resolving the expired body did not replace the newer snapshot. A
  40-day Retry-After stayed paused across a mode switch. HTTP 403 with a hung
  body immediately cleared evidence/stopped and remained stopped in OI mode.
  The fixture had connect-src none, was not committed, and preview was stopped.
  This is component/browser behavior verification, not live source validation.

Only the Polymarket browser hook and its browser helpers changed in production.
No financial values, schemas, source requests, database, leases, cache migration,
access settings or provider routes changed. A-share and Kraken work was not
repeated or modified. This focused audit is not a blanket claim that other asset
page lifecycles are free of defects or that live data acquisition has recovered.
