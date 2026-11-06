# Cboe delayed-price browser lifecycle audit

Baseline: public main `46ccb1285c0363580f8a5cdaba5862299bb1d653`,
private Site v61, public tree `ba621fdd97f65349aa75dbf14f5d29c1785078bc`.

## Reproduction

Three initial synthetic regressions demonstrated requests that should not have
started: HTTP 403 produced four application requests in 180 seconds; a hidden
initial mount requested once; and a one-hour structured retry deadline still
produced four requests in 180 seconds. Existing tests verified that structured
source denial stopped polling, but not that HTTP access denial stopped it.

The expanded first-pass suite failed 17 of 20 tests on the unchanged component.
It additionally reproduced ignored-abort fetch/body waits that never left the
busy state and cached replies that remained labeled successful after their
refresh interval elapsed while hidden.

## Correction

An isolated Cboe browser hook now checks mount, visibility, terminal stop, active
logical request, and the effective cooldown before every request. It schedules
one successor from completion, at least 60 seconds later, respecting whichever
is latest: the local minimum, HTTP Retry-After, or structured next_retry_at.
Long deadlines are unchanged; only individual timers are chunked at the signed
32-bit browser limit.

The existing 50-second browser deadline now independently settles fetch/body
waits even if the awaited promise ignores abort. Identity guards prevent late
results publishing. Known 401/403/407/451 and redirect headers stop before JSON;
manual redirects prevent following authentication paths. A hidden page admits
no new work but lets already-admitted work complete under its existing deadline.
Unmount aborts the browser wait and prevents further scheduling. These actions
do not settle, reset or take over a provider lease.

Conservative evidence handling is retained: transport failure before response
headers may preserve an age-valid previously verified price; an unverifiable
received reply clears it. This includes HTTP 429 invalid bodies and received
body timeouts, while retaining any already-observed Retry-After. Provider-side
429 denial semantics are unchanged. Terminal denial clears all displayed prices.

Original cache clocks and the 24-hour maximum age are unchanged. A retained
snapshot becomes visibly stale once its refresh interval elapses. The UI shows
the effective next check, including HTTP/browser pauses, and explains that
checks require an open visible page rather than continuous background collection.

The 15-minute minimum source delay, exact source decimal prices, currency/ISIN
scope, neutral color and nonmonetary card layout are unchanged. This remains
selected Cboe BXE delayed trade prices, not current exchange quotes, capital flow,
market capitalization, or comprehensive European coverage.

The already-tested generic browser wait/deadline helpers moved unchanged from
Polymarket's component directory to `lib/browser-request.ts`; Polymarket only
changes its import, with all 19 existing lifecycle regressions passing.

## Native test harness repair

The Cboe native test script assumed its migration was the final journal entry.
Later A-share, Japan and Polymarket migrations invalidated that assumption. The
script reported intentional Polymarket schema changes as Cboe corruption and
created no Cboe table in the absent-client-signal deadline scenarios.

The script now selects `0018_cboe_delayed_quotes` by identity, verifies earlier
tables immediately after that migration, applies subsequent migrations in order,
then verifies runtime isolation against the full current schema. Deadline tests
also create the full current schema. Their existing timeout, lease-release,
request-count and cooldown assertions remain intact. No production migration or
schema was changed. Independent review found no weakened intended guarantee.

## Verification

- 26 new lifecycle tests cover the initial failures, early permission headers,
  manual/opaque/followed redirects, concurrent/wake guards, both HTTP/structured
  deadline orderings, 40-day timer boundaries, ignored-abort recovery, warm
  denial/body-failure clearance, original expiry, filters, and unmount cleanup.
- Independent review: 26 lifecycle plus 8 existing UI tests passed; no blocker.
- Full hosted suite: 123 files / 1,985 tests. TypeScript, zero-warning ESLint,
  production build, 62 client assets across both RSC manifests / 51 Vite entries /
  bootstrap, and both asset regressions passed.
- Native workerd/D1 tests passed with real networking disabled: shared cache,
  separate price and empty-check clocks, later cancellations, persisted retry,
  warm/cold denial, malformed rows, migration/runtime isolation, and absent-client
  signal map/file stalls releasing their exact leases in about 18 seconds.
- Offline Chrome, real production component with synthetic responses: a hung
  body ended after 50 seconds, followed by one successful check after a full
  60-second cooldown. Resolving its expired body did not replace newer evidence.
  A 40-day Retry-After displayed the correct future deadline without freezing
  controls. HTTP 403 with a hung body immediately cleared/stopped.

The browser fixture had `connect-src 'none'`, was kept outside the repository,
and its preview was stopped. Hidden visibility and exact long-deadline behavior
were tested with synthetic events/fake clocks, not physical-device testing. No
production HTTP/authentication, provider requests, gate changes or access changes
were performed. These checks do not establish live production data availability.
