# Brazil CVM browser refresh lifecycle

Baseline: public main `a7a376c72e63a97e5e209c701cc8a8e1557157f1`,
private Site v63, tree `eb8e34390b6dd8cae83c0af1b21659031c925b34`.

## Reproduction

Eight initial synthetic regressions failed on the unchanged CVM component:
ignored-abort fetch and JSON reads kept the browser busy after its 65-second
deadline; hidden initial/manual checks still requested; repeated manual and
visibility checks ignored the structured daily pause; a 40-day Retry-After
with a stalled body never completed the wait; a permitted 60-second coordination
retry waited a day instead; and HTTP 407/451 could wait on a stalled body rather
than stop immediately. These describe browser behavior, not observed failures
of the real CVM provider or native network implementation.

## Correction

CVM now uses the previously hardened official-report browser lifecycle. Its
65-second budget is passed explicitly; Japan and Taiwan retain the existing
30-second default. Fetch/body waits settle independently of an ignored abort,
late responses cannot overwrite newer data, and every request checks visibility,
active work, terminal stop and the effective retry deadline. An admitted request
may finish while hidden, but hidden pages start no successor.

The normal successful daily cadence remains. A coordinating response may permit
an earlier check after at least 60 seconds. Longer structured or Retry-After
pauses are never shortened, and large timers are safely chunked. Manual controls
respect the same pause and show the effective next check. HTTP access denial and
redirects stop before reading a stalled body; structured source denial stays
terminal. No source URL fallback or authentication attempt is added.

The BRL monthly fund-transaction scope, confidentiality, exact company/industry
join, observed reporting month, original successful acquisition clock, seven-day
cache limit and 180-day report limit are unchanged. No prices, holdings changes,
foreign holdings or synthetic observations are substituted for trading amounts.
The service and persistent source gate are unchanged.

## Verification

- 12 new browser tests, including the original eight failures, late-body
  isolation, admitted hidden work, stale/cache-expiry behavior and impossible
  structured timezone offsets.
- Existing 10 CVM UI tests retain their original business assertions, advancing
  through the permitted daily check instead of bypassing the pause.
- Independent review: 11 related test files, 128 tests pass; no blocker. Shared
  Japan/Taiwan deadline regressions confirm the default remains 30 seconds.
- Full candidate suite: 126 files, 2,032 tests pass. TypeScript, zero-warning
  ESLint, production build, 62 client assets / 51 Vite entries, and both offline
  built-asset/bootstrap checks pass.
- Native CVM runtime: seven synthetic scenarios pass, covering plain/gzip/Brotli
  parsing, exact joins and cold-worker cache/cooldown, two-day Retry-After,
  previous-evidence invalidation on denial, durable denial across workers, and
  retained cleanup after an early response. All prior gates stay unchanged and
  external networking is disabled.
- Offline real-component browser: a synthetic body began at 04:00:22 UTC,
  timed out at 04:01:27, then recovered at 04:02:27. Resolving the expired body
  did not replace that report. A 40-day Retry-After displayed December 16 and
  disabled premature checks. A stalled-body HTTP 451 immediately cleared the
  report and displayed stopped. Amounts were explicitly synthetic and outbound
  connections blocked.

## Scope and limits

The parallel global-page audit found separate TIC source/browser retry and
permission issues. Those are tracked separately and are not fixed by this CVM
change. Global country changes and TIC/history disclosure closing were confirmed
to unmount their content; no unrelated navigation rewrite was made.

No production HTTP/browser/authentication request or real provider request was
made. No database, gate, runtime setting or permissions were changed. Local
verification and deployment provenance do not establish live provider access or
production freshness. Monthly CVM reports remain monthly, not real-time flows.
Remote CI is not claimed from these local checks.
