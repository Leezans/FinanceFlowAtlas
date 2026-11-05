# FinanceFlowAtlas hosted application

This optional Sites/Vinext application lives alongside the Python API and Vite web app. It does not replace either. It renders the reviewed country treemap with a geographic-map alternative and a read-through Treasury TIC adapter backed by D1.

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

## Deployment configuration

`.openai/hosting.json` declares `DB` and no R2 bucket. Project identifiers, credentials and provider runtime state are deliberately omitted. Configure a new deployment through supported Sites tooling, retaining the authentication boundary in `worker/index.ts` and `app/chatgpt-auth.ts`. Do not commit generated deployment identifiers or authentication tokens. Public source publication does not make an existing deployment public.

## Data semantics

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
without an account. It also adds a separate, bounded BTC/USD, ETH/USD and SOL/USD
executed-trade imbalance matrix. See [trade source contract](../../docs/source-kraken-trades.md)
for the five-minute requested window, REST side-label uncertainty and incomplete
responses. The quote matrix shows last price, rolling-24h base-coin volume,
VWAP and trade count, not net capital flow, derivative open interest or global
crypto totals. Quote observation time remains unknown; the separate trade matrix
shows returned execution times independently of acquisition time.
One-minute caching, a 15-minute display expiry and a separate persistent
metadata-only source gate protect freshness and stop after access denial.
Keep the existing owner-only boundary; code publication does not grant provider
market-data redistribution rights. Apply `0003_brainy_donald_blake.sql` through
the supported migration workflow before deployment. Run
`npm run test:kraken-runtime` for offline native workerd/D1 checks, including
request cancellation after response completion and shared cooldown across
separate workers. The host retains cleanup before asynchronous inspection;
missing lifetime registration prevents source admission. No existing busy or
denied lease is reset, and this change requires no migration. See
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
capital flow. See `../../docs/source-cvm-fund-equity.md`.

## Open annual global equity context

`/equities` uses the shared matrix renderer for World Bank/WFE annual country
market cap and stocks traded value, grouped by region then country. All 249
geographic slots stay reachable, but only actual same-year source observations
receive magnitude colors; coverage counts clearly distinguish the two. Selected
country details use a separate two-metric matrix, initially USA. It never calls either measure net capital flow, mixes
observation years in comparisons, or fills missing observations with zero.
Both specific indicators are CC BY 4.0, with source attribution and terms in the
UI. No account or key is needed. The latest observation years, dataset update
and retrieval time are distinct. Apply appended `0011_worldbank_equity_cache.sql`
after 0010; it adds a separate daily refresh/shared cache without modifying
existing gates. Denial is durable; seven-day cache expiry also applies in the
browser. Run `npm run test:equity-runtime` for native workerd/D1 tests with real
network disabled. See [source evidence and limitations](../../docs/source-worldbank-equities.md).
