# TAIFEX daily institutional options amount matrix

## Scope and fixed source

`/options/taiwan` is a separate daily report view, not a replacement for the
Deribit chain at `/options`. It covers five TAIFEX product groups, call/put and
three institutional categories (dealers, investment trusts, foreign investors
and mainland China investors): exactly 30 report rows. These product groups are
not issuer industries. Stock and ETF options are source aggregates, not
individual securities. This is not all investors, global options or net capital
inflow. The institutional classes are aggregates, not one coherent strategy.

The only source request is one unauthenticated fixed GET:

`https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate`

No account, cookie, token, URL parameter, alternate endpoint, historical scan,
order, credential or user-supplied URL is used. The source served JSON with an
`application/octet-stream` content type in the 2026-11-06 verification. The API
then reported **2026-11-05**, even though the website report was already on
2026-11-06. Thus acquisition success does not establish that the API has the
latest exchange report. The source date is displayed unchanged. The transient
probe was not an authenticated hosted-site verification. Provider observations
are not committed or bundled as fallback data.

## Units and area

The source identifies monetary columns as thousands, but does not include a
currency property. TWD is established from the official product definitions:

- [TXO contract](https://www.taifex.com.tw/cht/2/tXO): NTD 50 per index point.
- [TEO contract](https://www.taifex.com.tw/cht/2/tEO?menuid1=12) and
  [TFO contract](https://www.taifex.com.tw/cht/2/tFO): NTD 250 per index point.
- [Stock and ETF premium-turnover statistics](https://www.taifex.com.tw/cht/7/monthlyOptData):
  both are explicitly in NTD and use premium × multiplier × contracts.
- [Institutional call/put report](https://www.taifex.com.tw/cht/3/callsAndPutsDate):
  trading contract amount is the sum of execution premium × contract multiplier
  × contracts. OI contract amount instead uses settlement premium × multiplier
  × OI. The two are kept separate.

`TradingValue(Long)(Thousands)` and `TradingValue(Short)(Thousands)` are
normalized by exactly 1,000 to `buy_amount` and `sell_amount` in TWD. Source Long
and Short here are buy/sell transaction sides, not an inferred bullish/bearish
signal. Matrix area defaults to buy-side amount and can switch locally to
sell-side amount. It never combines the two sides into a supposed unduplicated
market total. Color is a sequential scale of the same selected amount, not a
price return or flow-direction estimate. A filter changes the visible denominator.
Zero monetary values occupy no area but remain selectable in the full details.
No minimum-size, equal-area or absolute-net substitute is used.

Source contract counts are retained separately. OI values are not area weights.
The source reported buy-minus-sell and OI net columns remain in details, but are
not called cash inflow. Monetary columns can differ from separately rounded
buy-minus-sell by one source thousand; this tolerance is explicit, and reported
net values are not overwritten. Counts must balance exactly. A zero count requires zero amount for that side;
positive counts with rounded zero amount remain valid. All rows must have
one date and complete, unique source coverage; unknown product/category names,
missing/extra rows or columns, unsafe integer strings and invalid dates fail
validation. No prices, FX rates or volumes are used to infer monetary values.

## Date, sessions, freshness and limits

This is a daily trade-date statistic, including the preceding night session and
associated regular session where applicable. It is not a day-session-only report.
The [official notice effective 2021-12-06](https://www.taifex.com.tw/file/taifex/event/cht/newrule2021q4/file/%E5%8F%B0%E6%9C%9F%E4%BA%A4%E5%AD%97%E7%AC%AC1100201981%E5%87%BD-%E4%BA%A4%E6%98%93%E9%9D%A2%E6%B3%95%E8%A6%8F.pdf)
section 2(7) establishes this scope. The report includes block trades and relevant
foreign-underlying ETF transactions. Website approximate publication times do
not establish an API SLA and are not used as a countdown or freshness promise.
The API supplies no actual publication timestamp: `source_released_at` remains
null. Report date, acquisition start and successful fetch time remain distinct.

No numeric API quota or recommended polling interval was documented in the
inspected official OpenAPI, portal metadata or terms. This is not evidence of
unlimited access. The application conservatively shares one fixed one-hour
minimum source cooldown across all viewers and filters. A visible page requests
updates within that bound; no unattended scheduler is installed by this feature.

Cache older than one hour or report older than four Taiwan calendar days is
labelled stale. Cache older than 24 hours, a future report, or report older than
14 calendar days is hidden. These are application limits, not a claimed holiday
calendar or a source release guarantee. A new older report date cannot replace
the last known report. Temporary errors retain only still-valid old evidence,
with original times. Source availability is not a claim of real-time data.

## Attribution and reuse

[Government dataset 11600](https://data.gov.tw/dataset/11600) lists daily, free
access under [Government Open Data License v1](https://data.gov.tw/license) and
links the TAIFEX OpenAPI. The license permits reuse, redistribution and derivative
products with source/license attribution. [TAIFEX user terms](https://www.taifex.com.tw/cht/edu/userTerms)
expressly exempt government-open-data-authorized sets from their general reuse
restriction. The page attributes TAIFEX and the Financial Supervisory Commission
Securities and Futures Bureau and links the dataset, official report and license.
It does not claim provider endorsement. No account or separate explicit agreement
acceptance was required for the verified public dataset. The existing private
site's access settings remain unchanged.

## Independent source admission and migration

Migration `0023_taifex_options_gate.sql` adds only `taifex_options_gate`, its
`daily_institutions` row and constraints. It does not read, reset, expire,
take over or mutate the existing Deribit gate or any stopped provider. All TAIFEX
views/filters use this same row; there is no per-filter admission budget.

Admission is atomic in D1 with one retained worker lifetime, a 15-second bounded
request, bounded decoded JSON and no redirects. Busy or unknown admission is
fail-closed, including last-good evidence. HTTP 401/403/407/429/451, redirects,
HTML challenges and rejected content types stop this provider persistently and
atomically purge its cache. Denied/busy states have no automatic takeover or
reset. Temporary upstream errors preserve the exact validated prior payload,
honor Retry-After and keep at least the one-hour global cooldown. Late D1 results
remain retained until settlement, with no uncertain-operation retry.

`/api/v1/options/taifex/status` reads coordination/cache state only. It never
collects. The shared diagnostics view selects only fixed recorded clocks and
coordination metadata, not financial rows; it neither repairs state nor certifies
live data. The snapshot route alone can collect after allowed admission.

## Reproducible validation

- `npm test` covers strict source units/date/coverage/rounding, amount ratios and
  zero area, local-only filters, stale/expiry handling, source admission and UI.
- `npm run test:taifex-options-runtime` runs actual local workerd and D1 with all
  external network disabled and synthetic responses. It tests migrations,
  prior-state preservation, shared hourly cache/cooldown, plain and gzip/Brotli
  bodies with JSON and octet-stream content types, denial, retries and owned
  cleanup. Compressed octet-stream responses use a fixed-URL synthetic outbound
  service after the generic mock forwarding path failed to preserve that
  combination. All real network access remains disabled.
- `npm run test:diagnostics-runtime` verifies TAIFEX recorded clocks and stopped
  suppression with zero source calls or writes.
- `npm run lint`, `npx tsc --noEmit`, and `npm run build` validate integration.

Offline tests and a separate public API probe are not proof that authenticated
production browsers have received a first report. Do not claim hosted data
verification without a normal authorized observation.
