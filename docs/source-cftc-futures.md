# Selected US CFTC futures positioning

## Source and verified scope

The new `/futures` page uses the official CFTC Public Reporting Environment's
[Legacy Futures Only dataset](https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy-Futures-Only/6dca-aqww).
A fixed unauthenticated GET to `/resource/6dca-aqww.json` selects only the required
columns and four reviewed contract-market codes, orders by source report date,
and limits the response to 16 rows. No API key, account, cookies, login or paid
provider is used. No user-selected URL, query or contract is accepted.

The selected markets are gold (088691, COMEX), WTI physical (067651, NYMEX), corn
(002602, CBOT) and Euro FX futures (099741, CME). The current exact source names
and contract units are allowlisted. Source name/unit changes fail closed pending
review. This is not all US futures, global futures, OTC FX, a currency spot feed,
options, global commodity totals or real-time capital flows.

On 2026-11-05, a real unauthenticated request returned all four markets for
2026-10-27 and 2026-10-20. The actual implementation parsed that official reply
and validated both long and short OI balances. Provider observations were used
only in a local transient probe and are not committed or bundled. Live access
from the eventual production deployment has not been verified by this probe.

## Meaning of the numbers

All figures are counts of each market's own contracts. The Legacy categories are
commercial, non-commercial and non-reportable. They are not a classification of
skill, a guaranteed direction prediction or trading advice. Net position is a
category's long minus short count. The comparison is current net minus previous
reported net. The exact two dates and elapsed days accompany every comparison;
it is called a seven-day comparison only when the interval actually is seven.

The visual uses net contracts / current market open interest, on a common
negative 100% to positive 100% axis. Contract size differs between markets, so no
combined contract total, dollar notional or money-flow estimate is calculated.
Every open contract has both a long and a short side. Non-commercial spreading
is included on both sides of the source OI identity but cancels in directional
net positioning. OI identities must balance exactly for both report periods.

The latest two observations for every selected market are required, and all
four current dates must match. Missing, duplicated, foreign, malformed,
future-dated, negative, fractional, unsafe or unbalanced records are rejected.
At least eight and at most sixteen records are accepted. Old reporting dates
are never relabeled with the current clock date.

## Reporting time and freshness

The source has an observation date, but this API reply does not supply the
actual release time of each report. `source_released_at` remains null. Fetch
start, fetch completion and source report date are distinct fields. A frequent
browser check does not turn lagged data into real-time observations.

The [official release schedule](https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm)
currently describes the customary Tuesday observation / Friday 15:30 US Eastern
release, with holiday delays. The [October 27, 2026 announcement](https://www.cftc.gov/PressRoom/PressReleases/9316-26)
plans twice-weekly publication by year-end. The implementation does not infer
that the plan has started, hardcode Tuesdays, synthesize release timestamps, or
assume that consecutive observations are always seven days apart.

One-hour source checks, a one-day acquisition-cache expiry, a report-age
warning after 10 days, and a hard report-age display expiry after 35 days are
application policies, not CFTC freshness guarantees. Age is measured from the
reported date at UTC midnight; the UI labels that convention, rather than
claiming precise elapsed time since the exchange close. Temporary failures may
retain a previously validated snapshot as stale only within both expiry limits.
A denial clears the snapshot. Unavailable initial data stays empty, never zero
or sample bars. The browser independently enforces age expiry while hidden.

## Transport, shared gate and permissions

Acquisition has a 15-second deadline, 64 KiB decoded-body limit, strict JSON
parsing (including duplicate-key rejection), manual redirect refusal, no
credentials and no redirects to an alternate source. HTTP 401/403/407/429/451,
redirects and HTML/challenge replies permanently stop that gate. Ordinary source
failures use backoff and honor Retry-After. Unknown upstream exception codes are
not passed to the client.

An independent `cftc_source_gate` stores coordination metadata and the validated
public official report in existing private D1. The report cache is schema-checked
on each read; successful release stores it atomically with the acquisition
cooldown. A denial atomically purges it. Cold workers reuse this report without
re-fetching the source. Busy/cooldown coordination does not increase the source
failure backoff. A shared one-hour minimum cooldown and longer Retry-After prevent cold-worker
retries. Busy or denied records are not automatically reset or leased over.
Uncertain writes stop acquisition. Missing gate storage fails closed before any
source request. Snapshot/status routes are GET-only; status never fetches source
data. Existing A-share, Sina, Kraken and FX gates and their blocked states are
not modified. Only the reviewed public official CFTC observations are cached; no private
user financial information or credentials are stored.

The app preserves its existing owner-only hosting/access boundary and does not
change repository or hosting permissions. Free public access is not a claim that
every third-party linked work or branding has an unrestricted license. CFTC
source attribution and [explanatory notes](https://www.cftc.gov/MarketReports/CommitmentsofTraders/ExplanatoryNotes/index.htm)
remain visible. No accounts, private positions or trading execution are added.

## Validation and delivery limits

- Parser and API tests cover identity, units, OI, dates, interval semantics,
  completeness, byte/deadline limits, caching, stale/expired states, stop behavior,
  persistent-gate errors, query refusal, concurrent checks and no-secret diagnostics.
- Browser component tests cover category switching, signed normalized bars,
  incomplete data, two-day intervals, expiry while hidden, access removal,
  malformed successful replies, authentication redirects, double clicks, unmount
  aborts and source denial.
- `npm run test:cftc-runtime` runs the actual checked-in host in native workerd and
  D1 with all external network disabled. Synthetic plain, gzip and Brotli data,
  cold-worker cache reuse, shared cooldown, Retry-After and persistent denials are checked. Existing
  blocked A-share gate state must remain unchanged.
- TypeScript, ESLint and production build are separate required checks.
- Chromium screenshot testing was attempted but blocked before navigation by the
  execution environment's socket startup restriction. Component tests and build
  passed; visual browser QA is not claimed.

Apply the appended `0005_cftc_futures_gate.sql` using the supported migration
workflow before deployment, after existing migrations including the FX gate.
A repository commit alone neither applies production migrations nor deploys the
page. Cold workers use the same validated shared report. Missing, corrupt or expired
shared cache remains unavailable during cooldown; no acquisition limit is bypassed.
