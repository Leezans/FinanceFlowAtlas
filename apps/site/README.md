# FinanceFlowAtlas hosted application

This optional Sites/Vinext application lives alongside the Python API and Vite web app. It does not replace either. It provides independent country-owned industry and market matrices, with a geographic navigator and an explicitly separate U.S. Treasury TIC supplement backed by D1.

## Local setup and checks

Use Node.js 22.13 or newer. From `apps/site`:

```sh
npm run install:ci
npm test
npx tsc --noEmit
npm run build
npm run dev
```

`npm run lint` runs the starter and application ESLint rules. The build generates local worker configuration under `dist/server`; generated builds and runtime state are not source files. For a local database, apply `drizzle/0000_silly_ogun.sql` to the D1 binding `DB` using the local worker configuration before exercising cache-backed routes. Do not apply migrations to production as part of a local test.

### Production asset integrity and offline browser QA

`npm run build` verifies the emitted client assets in both RSC/SSR manifests,
the Vite client graph and the browser bootstrap on both execution profiles. The
managed build wrapper also performs the same assertion when invoked directly.
The pinned RSC plugin collects its manifest after Vite removes CSS-only JS
chunks, preserving the real CSS dependencies without creating dummy JS files.

`npm run test:build-assets` reproduces the original dangling CSS-only chunk with
the actual pinned Vite/RSC compiler, proves the corrected ordering preserves CSS
and verifies the isolated browser transport. No external requests are needed.
After building, `node scripts/prepare-built-browser-fixture.mjs` executes the
unmodified production Worker in native Miniflare with network disabled and saves
12 routes' original HTML, RSC responses and real client assets under the ignored
`.offline-built-browser` directory. Preview HTML only adds an early isolation
bootstrap that stubs every API request. These fixtures exercise hydration,
navigation and honest schema-error states, not populated or live market data.
They must not be deployed; regenerate them after any build change.

## Deployment configuration

`.openai/hosting.json` declares `DB` and no R2 bucket. Project identifiers, credentials and provider runtime state are deliberately omitted. Configure a new deployment through supported Sites tooling, retaining the authentication boundary in `worker/index.ts` and `app/chatgpt-auth.ts`. Do not commit generated deployment identifiers or authentication tokens. Public source publication does not make an existing deployment public.

## Data semantics

The Japan entry at `/markets?country=JPN` is a separate MOF weekly
nonresident-transactions sample for Japanese-issued securities. It is not
industry data, all domestic Japanese investors, JPX investor trading or a
whole-economy flow total. Equity/fund shares and two debt classes keep their
official signed amounts in 100 million JPY. Apply migration
`0020_japan_mof_weekly.sql` through the supported deployment workflow. It adds
an isolated six-hour source gate and normalized latest-report cache; no other
provider gate is reset. See [MOF source contract](../../docs/source-jp-mof.md)
and [JPX candidate assessment](../../docs/source-jp-jpx.md). JPX remains disabled
pending clarification of hosted secondary-display rights.

The hosted adapter discovers the latest complete, validated observation month present in the fetched official TIC table, with a rolling twelve-month history. It never infers unpublished data from the clock or presents monthly statistics as real-time prices. Foreign country means reported residence; the security issuer economy remains the United States. Signed monthly net transactions are distinct from holdings and from gross purchases or sales.

Treemap area is the absolute net amount divided by the sum of absolute net amounts of included reported countries, not market capitalization or the Treasury Grand Total. Zero rows are separate; missing rows have no area. No industry or individual-stock hierarchy is implied.

The IMF layer is explicitly unavailable in this hosted application. Separate daily ECB FX reference and Kraken spot layers are described below; neither extends TIC coverage. Selected CFTC futures positioning is another independent layer described below. A source failure preserves a last-good cached snapshot with stale status; no initial snapshot returns 503, never substitute data. Tests use synthetic fixtures only. No captured financial snapshots or private user data are bundled.

See [HOSTED_PROOF.md](HOSTED_PROOF.md) for cache validation and endpoint details, and [ATTRIBUTION.md](ATTRIBUTION.md) for separate geography and dependency licensing.

## Optional private A-share page

The separate `/ashare` page provides industry/stock provider evidence using bounded access to public Eastmoney endpoints. It does not replace TIC or assert general market-data redistribution rights. Source observation time, trading date and latency remain unknown; acquisition time is labeled separately. Provider order-classified main-net figures are estimates, not actual market-wide net money creation.

Validated A-share snapshots are shared in primary D1 `ashare_snapshot_cache` alongside the unchanged `ashare_source_gate`. Apply migration `0012_ashare_shared_snapshots.sql` after the existing migrations through the deployment’s supported workflow. One complete snapshot per scope is committed atomically with lease release; cold workers reuse it without another provider fetch. Freshness remains 60 seconds. Last-good evidence can survive temporary failures for at most 24 hours, retaining its original acquisition timestamp and explicit stale/error status. Storage is limited to 32 scopes (industry ranking plus up to 31 constituent scopes), each at most 2 MB; obsolete versions are replaced and expired entries pruned on successful publication. Busy, unknown, denied or unreadable permission state never returns persisted rows. Source observation time and trading date remain unknown. Authentication remains owner-only. Denials/challenges stop acquisition persistently rather than triggering alternate-route retries. Temporary collection failures enforce a shared minimum 60-second pause across isolates; successful acquisitions retain the 3-second quiet interval. The longer in-isolate exponential backoff remains in place. See HOSTED_PROOF.md for limitations; actual authenticated production source access is not claimed to have been verified.

### A-share exploration

The time panel separates the scheduled ordinary auction session (published 2026
exchange calendar, device clock in UTC+8), unknown source trading date/observation
time, and the timestamp/age of the most recent complete acquisition. It warns when
the displayed cache exceeds the 60-second check interval even while a background
tab is stale; a recent fetch never becomes a claim of real-time data. Calendar
coverage outside 2026 is explicitly unknown. See
[time semantics and calendar sources](../../docs/ashare-market-timing.md).

The treemap remains the primary view. Search and provider-net-direction filters apply to both the chart and its collapsed **数值明细** panel. The optional panel shows unscaled CNY amounts, deterministic magnitude/buy/sell/name sorting, and drilldown for zero/missing rows that have no treemap area. Missing amounts never become zero; area shares use only the absolute nonzero amounts in the current filter, not a whole-market denominator.

Same-scope refreshes preserve search, palette, filters, sorting, the expanded panel and selected stock evidence. If a selected stock changes direction, its detail updates even when it no longer matches the filter. Changing scope resets exploration. Temporary browser network/5xx errors retain only the currently selected scope’s validated browser snapshot, with an explicit browser-stale warning and its original acquisition time and ETag. Authorization failures, known source denials and invalid successful payloads clear displayed evidence. Tests use synthetic observations only. This UI increment neither changes acquisition permissions nor verifies live source access, and a repository commit does not deploy it.

### A-share heatmap readability

The A-share heatmap uses three equal-width positive and negative color bands anchored to the largest absolute reported `f62` value in the complete current scope. Search and direction filters change area shares but do not change this color scale; a new source snapshot can update it. The legend labels the signed range in CNY. No price-return or industry-aggregation estimate is used to produce a color.

Compact tiles retain signed amounts where they fit, and hover or keyboard focus shows unscaled net amounts, source-reported price change and the current area share. The chart lays out in measured CSS pixels, including on narrow screens, rather than shrinking a fixed 1000px canvas. Zero and missing values remain in the details panel without invented area. The view is still industry-to-constituent drilldown, not a whole-market nested hierarchy: verified, mutually exclusive constituent membership is not available in the current source contract. Tests and local visual fixtures use synthetic rows only; no test fixture is bundled in a production route.

### Offline A-share runtime checks

`npm run test:ashare-runtime` and `npm run test:ashare-snapshots-runtime` exercise the checked-in A-share host in native
workerd with a shared D1 database and separate warm/cold workers. Synthetic
plain/gzip/Brotli responses verify decoding and cache behavior. Temporary
failures must preserve a 60-second shared cooldown across workers and scopes;
a denial must remain blocked. All external network access is disabled. The shared-snapshot suite additionally covers multi-scope cold reads, expiry, corruption, denial with warm ETags, transactional rollback, stale tokens, retained late commits, cancellation. Bounded-retention coverage is in the SQLite unit suite. These
checks do not establish live provider availability or authenticated production
access. No database migration is needed for the cooldown change.


## Daily FX reference layer

`/forex` and `/api/v1/fx/reference` use the ECB public daily XML, without an account
or API key. This is a separate **exchange-rate reference** layer, not a capital-flow
or real-time-price layer. The page shows actual currency coverage, source reference
date, retrieval/check times, source precision and clearly labelled calculated
cross-rates. It links the official source and usage terms, and retains the existing
private site boundary.

A bounded namespace-aware XML parser rejects malformed data and date regressions.
Validated public ECB rates and check metadata are shared through the independent
primary D1 gate, so cold workers reuse the same snapshot during cooldown. Apply
appended migration `0006_ecb_fx_shared_cache.sql` after existing migrations
through the supported deployment workflow. Snapshot publication and the one-hour
success cooldown are atomic. Transient failures preserve stale validated rates
and acquisition time, with a shared fifteen-minute cooldown. Values expire seven
days after acquisition in both server and browser; failures never extend expiry.
Denials atomically clear rates and persist across restarts. Every cache read checks
the gate; busy, unknown or unavailable states fail closed, with no automatic lease
takeover or reset. Workers retain acquisition and late D1 settlement after the HTTP
response ends. Existing gate states are preserved by migration. No provider rates
are committed, and no accounts or credentials are stored. `npm run test:fx-runtime`
verifies native-workerd parsing, cache sharing, expiry and retained atomic cleanup
with synthetic plain/gzip/Brotli XML and real networking disabled. See
[the FX source contract](../../docs/source-ecb-fx.md) for timing, rights and limits.
## Personal Kraken spot layer

`/crypto` reads the validated online USD spot catalog and ticker from Kraken
without an account. It also adds a separate, bounded executed-trade imbalance matrix. BTC/USD,
ETH/USD and SOL/USD are the default; the owner can explicitly select one to three
pairs from the validated online USD catalog. See [trade source contract](../../docs/source-kraken-trades.md)
for selectable one/five-minute requested windows, REST side-label uncertainty and incomplete
responses. The quote matrix shows last price, rolling-24h base-coin volume,
VWAP and trade count, not net capital flow, derivative open interest or global
crypto totals. Quote observation time remains unknown; the separate trade matrix
shows returned execution times independently of acquisition time.
Quote cards stay equal-width: a price, base-coin quantity or trade count is not a
comparable transaction amount. The separate trade treemap sizes each pair by the
absolute USD buy-label minus sell-label notional over the same stored one/five-minute
window. Each selected pair receives at most two 1,000-trade pages; a full terminal
page remains unknown, including in the shorter window. Pagination stays within
the existing 12-second acquisition deadline and shared source gate.
Window and canonical pair selection are both part of the evidence cache key.
Changing either removes old trade evidence immediately without relabeling it. Capped responses receive no monetary area or directional color. Reported
zero imbalance and missing evidence remain distinct in the full details panel;
area does not imply net capital flow or complete interval coverage.
One-minute caching, a 15-minute display expiry and a separate persistent
metadata-only source gate protect freshness and stop after access denial.
Shared-lease contention and cooldown use the ordinary one-minute recheck; they
do not compound genuine provider failures into an unnecessary 15-minute pause.
Actual upstream failures still use exponential backoff and honor Retry-After.
Every source request still requires the unchanged durable gate's permission.
Validated quote/trade bundles now live in primary D1, so a cold worker can reuse
the selected cohort during successful shared cooldown without refetching or
changing its timestamps. Selection and window are canonical cache identities.
A missing selected cohort can use the latest validated quotes, with no trades
attached from another selection. Busy, denied, corrupt or unreadable permission
states expose no shared evidence. Storage deduplicates the latest and selected
references, retains at most 16 selections plus latest (17 bundles, 2 MB each),
and prunes expired/unreferenced versions on successful atomic publication.
Keep the existing owner-only boundary; code publication does not grant provider
market-data redistribution rights. Apply `0003_brainy_donald_blake.sql` through
the supported migration workflow, then append `0017_kraken_shared_snapshots.sql`
after existing migrations before deploying the shared-cache code. Run
`npm run test:kraken-runtime` for offline native workerd/D1 checks, including
request cancellation after response completion and shared cooldown across
separate workers. The host retains cleanup before asynchronous inspection;
missing lifetime registration prevents source admission. No existing busy or
denied lease is reset. Publication and successful lease release are one transaction;
all source limits and the original 15-minute fetched-time expiry remain. See
[scope, licensing and verified limits](../../docs/source-kraken-spot.md).

### A-share recovery and diagnostics

A single recovery strip identifies the failed stage (browser connection, source
connection/decoding, complete-page validation, coordination storage or access
stop). Its collapsed details contain only allowlisted codes and local handling
advice, not raw upstream bodies, URLs, SQL, tokens or exception text.

Snapshot and status replies carry `X-Ashare-Error-Code` and
`X-Ashare-Recovery: retry|stopped` when applicable, including stale 200 and 304
replies. Recoverable failures include a `Retry-After` countdown matching the
remaining in-isolate exponential backoff, including the global source cooldown
when the selected scope has no entry. Stopped acquisition does not advertise a
retry time. Diagnostics do not modify the validated snapshot schema or make the
ETag change once per second; no new status polling is added.

The one **重试当前来源** control is shown only for recoverable failures and is
unavailable during cooldown or a request. Manual and minute-based checks use the
same snapshot endpoint, with no force flag, gate reset, lease takeover, alternate
source, new access or bypass. Known permanent source stops and lost display/login
permission clear browser evidence and stop automatic checks for that scope.
Browser-retained bytes remain separate from server-stale responses; a successful
304 removes the browser-only failure marker without rewriting acquisition time.
All browser evidence is memory-only and is cleared on navigation/unmount.

Tests cover repeated clicks, interrupted scope changes, headerless older
responses, 304 recovery, exponential backoff, permanent stops and preservation of
search, palette, details and selected-stock evidence. These are synthetic local
checks, not proof of authenticated production source availability. No database
migration is required for this change.

## Selected CFTC futures positioning

`/futures` shows official public CFTC Legacy Futures Only positions for gold,
WTI physical, corn and Euro FX futures. Counts and changes are contracts, not
money flows. The diverging view uses a category's net position / the current
market's OI, with exact current/prior report dates, source release time unknown,
and explicit freshness limits. The no-account API is separate from the other
sources and preserves the owner-only host. Apply the appended
`0005_cftc_futures_gate.sql` after preceding migrations. Run
`npm run test:cftc-runtime` for offline native workerd/D1 checks. See
[scope, verified source and operational limits](../../docs/source-cftc-futures.md).

## TPEx institutional industry matrix

`/taiwan` and `/api/v1/taiwan/tpex/{snapshot,status}` add Taiwan OTC listed-company
institutional trading using two explicitly free, no-account OGDL v1 sources.
Official company industries support industry→company drilldown and four
participant selections. Values are **shares**, not currency or all-market net
capital flows. TWSE-listed stocks are not included. Missing company observations
remain null and unmatched securities are excluded with visible coverage counts.
Equal-area tiles use fixed ±100% net/(buy+sell) color intensity. Dense industry
and company matrices keep full readable labels in a bounded scroll canvas; no
rows are omitted to fit mobile screens.

Apply appended `0007_tpex_institutional_gate.sql` through the authorized deployment
workflow. The independent source gate preserves all existing gates. It shares the
validated public report for one hour, expires acquired data after 24 hours, and
permanently stops after denial/challenge with no fallback or lease takeover.
Run `npm run test:tpex-runtime` for native workerd/D1 synthetic checks, with all
external networking disabled. See [source rights, verified access, exact join
coverage and semantics](../../docs/source-tpex-institutional.md). Coding-runtime
source verification does not establish deployed-host availability.

## Brazil disclosed fund equity matrix

`/brazil` displays monthly CVM disclosed FIF-class share acquisition minus sale
amounts, in BRL, grouped by exact official company industry and ticker. Both
source datasets use ODbL. Missing/confidential transactions remain unknown and
are never allocated to sectors. This is partial fund activity, not all-market
capital flow. Security treemap area uses the absolute monthly net amount, with
source BRL cents converted uniformly to BRL. Industry overview area sums the
absolute nets of its reported securities, so opposing security flows do not
cancel area; the displayed industry number remains the signed net subtotal,
and color remains net/(buy+sell). It is not the absolute industry net or market capitalization. Unknown
securities stay in details without fabricated area; industry coverage counts
remain visible. See `../../docs/source-cvm-fund-equity.md`.

## Open annual global equity context

`/equities` uses the shared matrix renderer for World Bank/WFE annual country
market cap and stocks traded value, grouped by region then country. All 249
geographic slots stay reachable, but only actual same-year source observations
receive magnitude colors and USD-proportional area; coverage counts clearly
distinguish the two. One selected metric and its latest available comparison year
share an area scale. Region areas sum included reported country amounts, not a
claimed complete global total. Missing or older-year observations and genuine
zeros remain reachable in details without area. Selected country details use a
separate equal-width two-metric matrix, initially USA, because year-end stock
and annual turnover are different measures and may have different years. Neither
measure is labeled net capital flow; comparison areas never mix observation
years or fill missing observations with zero.
Both specific indicators are CC BY 4.0, with source attribution and terms in the
UI. No account or key is needed. The latest observation years, dataset update
and retrieval time are distinct. Apply appended `0011_worldbank_equity_cache.sql`
after 0010; it adds a separate daily refresh/shared cache without modifying
existing gates. Denial is durable; seven-day cache expiry also applies in the
browser. Run `npm run test:equity-runtime` for native workerd/D1 tests with real
network disabled. See [source evidence and limitations](../../docs/source-worldbank-equities.md).

## ASEAN annual country-sector FDI

The ASEAN view retains the full country × sector source-coordinate table and its
reported, zero, n.a, missing and duplicate-isolated states. Selecting one host
country adds a shared monetary treemap for that country's same-year specific
sectors. Source USD millions are uniformly converted to USD before sizing;
positive and negative values use absolute amounts for area and signed colors.
No cross-country amount denominator or aggregate is constructed.

The homogeneous subset excludes unspecified sector Z. Philippines sector area
compares net equity capital only, not debt or reinvested earnings. Singapore M
already includes N, so N is excluded from area to prevent overlapping coverage.
The complete original table remains available in a collapsed disclosure,
including excluded sectors and unknown/isolated records. Zero and unknown
amounts receive no area but remain selectable in details. These areas are not a
national FDI net total, stock-market flow or real-time investment measure.

## Private Polymarket informational matrix

`/polymarket` and `/api/v1/polymarket/{snapshot,status}` provide a separate,
no-account Gamma market sample with category/tag → market matrix drilldown.
The fixed keyset request traverses at most five pages of 100 open-market records,
ordered by descending market ID, and filters active/non-archived records locally.
This is not a volume ranking or full-universe coverage. Visible pages check every
30 seconds, with cross-worker D1
cooldown; this is bounded polling, not a tick stream. Prices are explicitly named
outcome-implied probabilities, not objective probabilities or recommendations.
Volume retains the source unit as unverified, and neither metric is funds flow.
Source record update time, unknown price observation time, and acquisition time
remain separate. Age-valid stale snapshots expire after five minutes.

Append `0015_polymarket_market_cache.sql` after the reserved A-share `0014`
migration through the supported deployment workflow, reconciling the journal.
Existing source gates and owner-private access remain unchanged. Busy/unknown
state fails closed; denied/challenged source access blocks persistently with no
fallback or reset. Run `npm run test:polymarket-runtime` for offline native
workerd/D1 checks. See [source contract and rights](../../docs/source-polymarket-gamma.md).
No live provider access is claimed by synthetic tests or by a repository commit.

### Bounded keyset coverage

The official [keyset contract](https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination) documents a 100-row maximum, opaque cursors, and no offset. Every refresh uses one existing durable lease, at most five sequential requests, 250 ms pacing, an 8-second page-start budget and the unchanged 12-second acquisition deadline. No page is fetched after denial, cancellation, cursor repetition, duplicate ID, or invalid ordering. A failed page invalidates the new acquisition rather than publishing an unmarked partial result. Ordinary failures retain only the previous completed age-valid snapshot.

The UI/API report actual page sizes, distinct source records, eligible displayed records, exclusions, collection start/end, and whether a cursor remained at the budget. Total market count is always unknown; even an exhausted response is not claimed as an atomic or complete universe. ID order is deliberate: a changing volume order can move rows between pages. This sample favors higher market IDs and is not a representative category census. Grouping uses source category, else the smallest tag slug, and retains/searches every source tag. This is a deterministic display grouping, not the provider's primary or exhaustive taxonomy.

The strict cache/browser schema accepts both v2 keyset and validated legacy v1 snapshots. A transient keyset failure preserves age-valid v1 rows with their original single-page, volume-ranked, 200-record coverage and grouping semantics, visibly labeled as a previous sample. No timestamp or field is relabeled to v2. Compatibility never resets a lease, alters a denial, or clears cooldown. No new SQL migration is needed. Keyset availability and ID ordering require a normal gated production verification. The docs allow 503 when keyset is not configured: report this honestly, with no automatic alternate endpoint.

Official [rate limits](https://docs.polymarket.com/api-reference/rate-limits) list Gamma `/markets` at 300 requests per 10 seconds and may queue excess requests. They are an upper bound, not a target or freshness guarantee. Our maximum five calls per completed refresh plus at least 30 seconds of shared cooldown is deliberately much lower. No order, wallet, account, trading, or flow-inference endpoints are used.

### Independent hot and newer-ID discovery

The default Polymarket page now opens **热门 · 24 小时成交量**, showing complete
market questions directly. The separate **较新 · 市场 ID** mode retains bounded
keyset coverage. Higher market IDs are only a recency proxy, not verified creation
chronology. Group browsing remains optional, with search, metric choice, and
selection retained independently for each mode. The page reports the actual
selected-price and 24-hour-volume availability, including missing and zero values.
It never substitutes cumulative, CLOB-specific, or event-level volume.

`GET /api/v1/polymarket/snapshot?view=hot` reads one official `/markets` window of
at most 100 records, requested by descending `volume24hr`; known numeric volumes
must be nonincreasing. Missing volume remains null. No cursor/total is provided,
so even a short response does not establish exhaustion or full ranking coverage.
`?view=newest` retains the existing five-page/500-record keyset collection. The
unqualified route remains newest for compatibility; both `status` views are
read-only. This is not endpoint fallback: each requested view uses only its own
fixed official path, and source denial stops both modes.

Both modes share the existing single `polymarket_source_gate` lease and at least
30-second durable cooldown. A new strict payload envelope can hold each mode's
last successful snapshot and original acquisition timestamps, still within the
existing 2 MB combined cache bound. One-mode and legacy v1 payloads remain valid.
A failed or oversized refresh preserves the previous payload exactly; a denied
source clears both modes. Each mode independently expires after five minutes.
The visible page checks only its selected mode, and switching does not bypass
shared cooldown or reset the permissions boundary. No SQL migration or source
gate reset is required. Neither synthetic tests nor public documentation establish
current provider availability; verify only through the application's normal gate.


### Kraken selected-pair exploration

The searchable selector uses only the verified full USD quote catalog, including
catalog members whose ticker is unavailable. Draft changes do not fetch. Apply
commits one to three display names; the server resolves them against its own
catalog, never accepting a browser-supplied source ID or URL. Unknown or delisted
names are explicitly listed as catalog-missing and are never requested upstream.
Missing observations do not become zero or a substitute pair.

Explicit `?pairs=ADA/USD,XRP/USD` snapshot requests use a canonical sorted selection
and `kraken-trades/2` with `selected_pairs` plus response `requested_pairs`. The
legacy no-query request retains its exact default `kraken-trades/1` wire shape.
Repeated, malformed, duplicated or oversized query selections fail before gate
or provider access. Status queries remain read-only.

One bounded in-memory quote/trade bundle carries the selection key, with one
shared in-flight acquisition and existing global cooldown. Quotes always cover
the full validated USD catalog and remain usable during a selection change.
Trade amounts are returned only when their key matches the requested selection.
Concurrent different selections may wait for the same acquisition but receive no
other selection's trade evidence and cannot immediately start a second fetch.
Switching selections never resets the shared source gate, cooldown or deadline.
The browser clears old trade evidence immediately, preserves valid quote context,
and ignores late old-scope results. Denials and permission loss clear all evidence
and stop checks even when the response belongs to a previous selection.

The unchanged acquisition budget is at most one catalog GET, one ticker GET and
three single-page Trades GETs, with 1.1-second spacing and a 12-second total
deadline. Exact USD decimal arithmetic, the common five-minute requested window,
1,000-row caps, original execution/acquisition timestamps, stale retention and
15-minute expiry remain unchanged. This expands which pairs can be explored, not
simultaneous coverage, source-side semantics, update frequency or redistribution
rights. It is still one-venue returned-trade evidence, not global net capital flow.

Verification uses synthetic fixtures only. Selection tests cover canonical cache
identity, arbitrary catalog aliases, missing pairs, concurrent selections,
cooldown, explicit-default/legacy reuse, failed refresh retention, strict client
validation and global denial. The native workerd/D1 suite verifies custom
selections and cross-worker cooldown with real networking disabled. No new
provider, account, subscription, migration or standing collection process is added.

## Shared monetary area and zoom

All monetary heatmaps use one presentation contract and renderer. Source projections
supply signed base-unit amounts, a currency and a comparison key identifying the
metric and observation scope. The renderer accepts a common area scale only when
all rows declare the same currency and key. It never parses display strings,
converts currencies or uses color ratios, prices, percentages or legacy weights as
money. Noncomparable observations remain explicit information cards.

Treemap leaf area is strictly proportional to the absolute nonzero amount; group
area is the sum of its included leaf magnitudes. Geometry uses no rounding,
padding or minimum-area substitute. Reported zero and missing amounts have no
area and remain reachable in the complete numeric details. Signed color scales
remain independent. Annual stock-market capitalization and traded-value metrics
are separate scopes, and the selected-country two-metric panel is not a shared
amount scale.

`lib/matrix/layout.ts` owns pure comparability and geometry;
`lib/matrix/viewport.ts` owns pure bounded transforms;
`components/matrix/MatrixViewport.tsx` owns pointer, wheel and keyboard interaction;
`MatrixHeatmap` renders evidence and accessible details. A-share uses this same
renderer while retaining its source-specific exploration and evidence panel.

Wheel capture is explicit opt-in. The inactive chart preserves page scrolling and
native touch gestures. Zoom controls and +/- work without a wheel; an activated
chart supports drag/pinch and arrow-key panning. Escape returns page scrolling,
Home or Reset restores the full view, and zoom limits release wheel events back
to the page. Zoom survives same-scope refreshes and resets on a new scope or size.
No source acquisition, polling, cache, permission gate or privacy boundary changes.
Tests and browser QA use synthetic fixtures, never bundled production sample data.


## Country-owned global market matrices

`/markets` now opens the selected country’s own source, not a map of foreign
transactions in U.S. securities. The 249 geographic entries do not imply global
coverage. China’s CNY order-classified estimates, Taiwan OTC’s daily TWD
institutional summary and Brazil’s monthly BRL public-fund trades retain distinct
units, periods, scope and availability. Unsupported markets have an empty
industry-money-flow canvas. TIC is a collapsed, explicit U.S. supplement. There
is no world net-flow total or conversion of prices/holdings into money flow.

The new Taiwan monetary summary has exact source parsing, nonoverlapping
participant areas and a separately displayed total. Its optional industry/company
panel still measures shares; the summary is never allocated into sector money.
New report transport/lifetime/cache code is reusable under `lib/reports`, while
source semantics stay in `lib/national` and country composition in
`components/markets`. No production data or source snapshots are bundled.

Migration `0016_tpex_summary_gate.sql` preserves the existing TPEx provider gate.
Its blocked/busy/unknown/cooldown state prevents summary source requests, and a
known block removes cached evidence. The current deployed TPEx stop is not
reset or bypassed. This adapter’s offline tests do not establish live access.
See [country-owned semantics](docs/global-own-market.md),
[runtime boundaries](docs/tpex-summary-runtime.md), and
`npm run test:tpex-summary-runtime`.

## Bounded intraday fiat FX view

`/forex` now opens a **Kraken venue spot** matrix for AUD/USD, EUR/USD and
GBP/USD. The optional ECB tab remains a daily reference view; only the selected
view mounts. This is not worldwide wholesale FX coverage or a net-capital-flow
feed. Rates, 24h VWAP, base-currency volume and trade counts use equal-area matrix
tiles. Rate color is explicitly last-price/VWAP deviation, not daily return.

The view reuses `/api/v1/crypto/kraken/snapshot` with the existing explicit
three-pair selection. There is no new provider endpoint or source gate; the later
shared Kraken cache also serves these fiat selections. This view adds no separate
schema, database table or migration. The same retained 12-second acquisition,
1.1-second request spacing, six trade-page maximum and shared 60-second cooldown
apply. The common client lifecycle preserves original acquisition times,
15-minute expiry, selection/window identity, authorization and denial clearing.

Ticker observation time and latency remain unknown. Returned trade execution
times are shown independently for the selected one/five-minute fixed window;
they are not timestamps of the ticker rate and are not a guarantee of the latest
venue trade. See [source and validation boundary](../../docs/source-kraken-fx.md).

## European delayed trade-price supplement

`/europe` adds a separate Cboe BXE delayed price matrix, using the shared matrix
component and equal-width neutral cards. It is a bounded view of eligible
BATE/BATD/BATP equities/ETF trades in the latest five published minute files,
not national capital flows or complete European market coverage. Data are at
least 15 minutes delayed; a visible tab checks for updates each minute within
shared cooldown/backoff. Exact currencies, ISINs and original source/acquisition
times are kept separate. No issuer-country, industry, daily return or net inflow
is inferred, and an empty after-close window remains empty.

The source is free and anonymous for this private internal use. Migration
`0018_cboe_delayed_quotes.sql` adds an independent durable gate and shared cache;
existing source stops are not reset. Deployment must remain owner-only. See the
[source, usage and validation contract](docs/source-cboe-delayed.md) and
`npm run test:cboe-runtime`. No provider observations are bundled in source.
