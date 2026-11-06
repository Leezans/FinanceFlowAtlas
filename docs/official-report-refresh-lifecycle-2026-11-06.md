# Japan and Taiwan official-report browser lifecycle audit

Baseline: public main `9b485537b71def28f96844fcc74f6f50c603ad61`,
private Site v62, public tree `0b853e1749e155d9490a2f62dadc3a4c34c65d0b`.
The audit covers the shared browser report hook used by Japan MOF weekly
nonresident transactions and Taiwan TPEx daily institutional transaction amounts.
It does not turn either source into real-time flow or change the independent
Taiwan share-count drilldown, Polymarket open-interest acquisition, or provider gates.

## Reproduction and correction

The first 17 synthetic regressions failed 11 tests on the unchanged hook.
A fetch or body promise that ignored abort could keep the page busy forever
after the 30-second deadline. Hidden mounts still requested; manual and visibility
checks ignored server deadlines. A response explicitly allowing a retry after
120 seconds instead waited the normal six-hour Japan polling interval.

The browser now races fetch and JSON reads against its existing deadline,
releases the logical busy state, and independently guards late results. Checks
require a mounted, visible page with no active request or terminal stop. One
successor is scheduled on completion, respecting the latest observed HTTP
Retry-After, structured deadline, and 60-second minimum recovery pause.
Successful replies with no deadline keep the normal six-hour Japan or one-hour
Taiwan cadence. A 40-day pause is retained exactly while each timer is capped
at the signed 32-bit browser limit. Admitted hidden work can finish, but hidden
pages start no successor. Unmount aborts the browser wait and prevents publication.

Known HTTP 401/403/407/451 and redirect responses stop before reading a stalled
body. Structured denial is terminal. No authentication or source-address fallback
is introduced. Invalid successful payloads clear displayed evidence; transient
network failures may retain only still-valid evidence at its original timestamp.
Existing report-age warnings and original cache expiry continue while hidden.
Both amount views display their effective next check and disable premature checks.

Independent review found a second failure: the datetime schema accepts some
impossible numeric timezone offsets, but Date.parse returns NaN. Feeding NaN
into a maximum deadline can schedule an immediate request loop. Restoring that
behavior in a controlled mutation caused 101 Japan, 101 Cboe, and 102 Polymarket
requests within 100 simulated milliseconds. A shared finite absolute-deadline
parser now rejects these values. Valid longer server pauses remain unchanged;
Cboe keeps its 60-second minimum, Polymarket its 30-second shared minimum and
interest-mode isolation. A valid non-interest mode pause remains the fallback
when the shared datetime is invalid.

## Verification

- 35 new tests: 24 shared-report lifecycle tests and 11 deadline/cross-page tests.
  These cover hung fetch/body recovery, hidden-page behavior, original cache
  expiry, six-hour/40-day and Retry-After pauses, short source coordination,
  header/body conflict, redirects/denials, late results and unmount cleanup.
- Existing Japan and Taiwan UI tests retain amount, scope, denial, network,
  malformed-payload, revision and drilldown assertions, now advancing through
  the source cooldown instead of bypassing it with immediate manual checks.
- Independent review: 9 relevant files, 131 tests pass; no release blocker.
- Full suite: 125 files, 2,020 tests pass. TypeScript, ESLint, production build,
  62 client assets / 51 Vite entries and offline built-bootstrap checks pass.
- Native synthetic runtime: Japan MOF 5 scenarios; TPEx summary 9 scenarios
  plus 20 admission/publication provider-transition races pass. External
  provider networking is disabled by the harnesses.
- Offline browser with the real Japan/Taiwan components: a body stalled at
  03:42:13 UTC, aborted at 03:42:43, and recovered at 03:43:43. A late body did
  not replace the newer result. After rebuilding against final code, an invalid
  offset retained a 60-second next check; a 40-day Retry-After displayed
  December 16 rather than overflowing; a stalled-body 403 immediately showed
  stopped/blank. Taiwan's independent daily amount remained visible with its
  own timestamp and one-hour deadline. All data was synthetic and outbound
  connections were blocked.

## Limits

This is code, synthetic-runtime, and offline-browser verification. It is not
proof of live provider access, production freshness, production authentication,
or currently available monetary data. No protected production page, provider,
credential, runtime setting, gate or database was accessed or changed. Missing,
expired or denied evidence remains blank rather than being replaced by prices,
share counts, US TIC data, or synthetic values. Remote CI is not claimed from
these local checks.
