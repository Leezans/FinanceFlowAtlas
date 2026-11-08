# Selected US CFTC futures positioning

## Source and verified scope

The new `/futures` page uses the official CFTC Public Reporting Environment's
[Legacy Futures Only dataset](https://publicreporting.cftc.gov/Commitments-of-Traders/Legacy-Futures-Only/6dca-aqww).
A fixed unauthenticated GET to `/resource/6dca-aqww.json` selects only the required
columns and 52 reviewed contract-market codes, orders by source report date,
and limits the response to 208 rows. No API key, account, cookies, login or paid
provider is used. No user-selected URL, query or contract is accepted.

The reviewed manifest covers 52 markets in eight application navigation groups:
metals (5), energy (5), grains/oilseeds/soft commodities (11), livestock (3),
currency futures (11), rates (8), equity/volatility indices (7), and crypto
futures (2). The original gold, WTI physical, corn and Euro FX markets remain.
All selected markets are US CFTC-reported exchange futures. A foreign currency,
international index or Brent underlying does not mean the whole foreign market
is covered. These are all-expiry market positions, not individual delivery-month
quotes. This is not all US futures, global futures, cash stocks, spot FX, crypto
spot trading, options, global commodity totals or real-time capital flows.

Exact source names and contract units are allowlisted in
`apps/site/lib/futures/contracts.ts`. Source identity/unit changes fail closed.
The three consolidated equity-index aggregate series are deliberately excluded.
The Ether market retains the official source unit `(50 Index Points)`; no
unverified `50 ETH` substitution is made.

On 2026-11-06, one bounded unauthenticated query of the official dataset returned
761 records across 2026-10-27 and 2026-10-20. It contained all 104 observations
for this reviewed selection, each with exact long and short OI balance and
stable identity/unit. The actual new parser accepted those saved observations
offline, producing all 52 markets and eight groups. Financial observations are
not committed or bundled; tests use synthetic counts only. This research query
does not establish the deployed site's source access or current production
data. Those must be separately verified through the existing production gate.

## Meaning of the numbers

All figures are counts of each market's own contracts. The Legacy categories are
commercial, non-commercial and non-reportable. They are not a classification of
skill, a guaranteed direction prediction or trading advice. Net position is a
category's long minus short count. The comparison is current net minus previous
reported net. The exact two dates and elapsed days accompany every comparison;
it is called a seven-day comparison only when the interval actually is seven.

The primary visual is a nested asset-category / instrument matrix. The eight
groups are application navigation categories, not CFTC industry classifications
or sector aggregates. Each group contains only its reviewed selected markets. Every instrument has equal tile area;
color uses net contracts / current market open interest on a fixed negative 100%
to positive 100% scale. Zero positions keep their neutral tile and do not imply
zero open interest. Selecting a tile opens the source contract counts, exact
current/prior dates and changes. Contract size differs between markets, so no
combined contract total, dollar notional or money-flow estimate is calculated.
Every open contract has both a long and a short side. Non-commercial spreading
is included on both sides of the source OI identity but cancels in directional
net positioning. OI identities must balance exactly for both report periods.

The latest two observations for every selected market are required. All 52
current dates must match and all 52 previous dates must match; a missing period
cannot silently fall back to a different older period for one market. Missing,
duplicated, foreign, malformed, future-dated, negative, fractional, unsafe or
unbalanced records reject the entire new acquisition. At least 104 and at most
208 records are accepted. Old dates are never relabeled with the current clock.

Version-2 snapshots contain exactly the reviewed 52 unique markets. Version-1
four-market snapshots remain readable within their original freshness limits,
with original clocks and coverage, visibly marked as retained four-market data.
They are never relabeled as 52 markets or accepted as a new successful write.
A failed expansion retains only a valid last-good snapshot; a denial suppresses
it. No gate/lease/cooldown is reset to force an upgrade.

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

Visible-page checks with a one-hour shared source cooldown, a one-day acquisition-cache expiry, a report-age
warning after 10 days, and a hard report-age display expiry after 35 days are
application policies, not CFTC freshness guarantees. Age is measured from the
reported date at UTC midnight; the UI labels that convention, rather than
claiming precise elapsed time since the exchange close. Temporary failures may
retain a previously validated snapshot as stale only within both expiry limits.
A denial clears the snapshot. Unavailable initial data stays empty, never zero
or sample tiles. The browser independently enforces age expiry while hidden.
Closing the page does not install an autonomous collector; the UI states this
request-driven limitation. A more frequent check cannot make a weekly report
real-time.

## Transport, shared gate and permissions

Acquisition has a 15-second deadline, 256 KiB decoded-body limit, strict JSON
parsing (including duplicate-key rejection), manual redirect refusal, no
credentials and no redirects to an alternate source. HTTP 401/403/407/429/451,
redirects and HTML/challenge replies permanently stop that gate. Ordinary source
failures use backoff and honor Retry-After. Unknown upstream exception codes are
not passed to the client. The normalized cache remains capped at 64 KiB UTF-8;
the strict 52-market shape, allowlisted strings and maximum contract counts
fit this budget. Diagnostics recognize both versions without reading positions.

Before admission, the host synchronously registers the acquisition and all owned
D1 settlement with Workers `waitUntil`. Missing or failed lifetime registration
fails closed before acquisition. With the production `enable_request_signal`
flag, a disconnected request aborts collection but retains release of its own
lease and the shared cooldown. A bounded response can finish before an uncertain
D1 result, but the original operation remains retained through settlement,
including a late granted lease's abort cleanup. No late result is taken over,
reset or retried. An observed source denial still persists if cancellation also
occurs. Workers lifetime limits or process loss can still leave a busy gate; the
application does not automatically clear it.

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
  persistent-gate errors, query refusal, concurrent checks, cancellation, rejected
  lifetime registration, retained late D1 settlement and no-secret diagnostics.
- Browser component tests cover trader and instrument switching, signed normalized matrix colors,
  incomplete data, two-day intervals, expiry while hidden, access removal,
  malformed successful replies, authentication redirects, double clicks, unmount
  aborts and source denial.
- `npm run test:cftc-runtime` runs the actual checked-in host in native workerd and
  D1 with all external network disabled. Synthetic plain, gzip and Brotli data,
  distinct warm/cold worker cache reuse, shared cooldown, Retry-After and
  persistent denials are checked. An explicit abort after the HTTP response ends
  verifies retained cleanup in native workerd; Miniflare does not forward actual
  Node-client socket cancellation. The appended migration and runtime must leave
  all 20 unrelated data tables unchanged after all 24 migrations. Expanded native
  scenarios check four-period bodies above the old 64 KiB transport limit,
  exact legacy-cache reuse/upgrade, missing or invalid new markets, prior-period
  mismatch, source byte overflow, and existing blocked/busy/cooldown preservation.
- TypeScript, ESLint and production build are separate required checks.
- Historical four-market local browser QA covered the actual `/futures` unavailable-storage state and
  a temporary synthetic-data harness at desktop and a 375px iframe (360px
  document excluding the scrollbar). Four cards, commercial negative positions,
  non-reportable zero positions, EUR 125,000 contract details, dark-background
  contrast and no horizontal overflow were checked. The harness was removed;
  no synthetic route or financial fixture is shipped. This does not establish
  live CFTC or authenticated production availability.

The existing `0005_cftc_futures_gate.sql` is still required on a fresh installation,
after preceding migrations. The 52-market expansion adds no migration and
changes no hosting/access policy. A repository commit alone does not deploy
this page or verify production data. Cold workers use the same validated shared report. Missing, corrupt or expired
shared cache remains unavailable during cooldown; no acquisition limit is bypassed.


## Organized current evidence

The secondary collapsed panel below the matrix organizes the exact currently
visible validated snapshot, with a local Blob JSON download and 120-row preview.
It preserves both source versions, all retained markets, original contract-unit
text and each market's current/prior dates, without deriving net positions,
changes or cross-market totals. Legacy snapshots with differing previous dates
keep those dates per market. The file contains 832 position fields for version 2
or 64 for version 1, plus the complete strict validated native snapshot.

Position counts, two-sided OI relationships and spreading are not cash flows or
volume, and category navigation is not CFTC industry classification. Source
provenance, null actual release time and unknown license URL are explicit.
Matrix selection does not narrow the file. The same visibility/permission policy
and a final click-time check withdraw expired/denied exports; replaced and
withdrawn Blob URLs are revoked. No API, gate, storage, request cadence or
collection semantics change. See [the projection contract and tests](organized-report-projection.md).
