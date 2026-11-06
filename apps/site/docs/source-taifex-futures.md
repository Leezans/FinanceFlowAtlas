# TAIFEX daily institutional futures notional amounts

## Purpose and official source

`/futures/taiwan` is a separate daily institutional futures report. It does not
replace the CFTC weekly position page, claim real-time capital flows, or extend
coverage to FX or commodity futures. The source covers stock-index and stock/ETF
futures only. Product groups can have overlapping exposures; they are not a
complete disjoint issuer-industry taxonomy. Stock and ETF rows are aggregates,
not individual contracts or securities.

Fixed unauthenticated GET, with no caller parameters, cookies, accounts or orders:

`https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate`

[Official report and definitions](https://www.taifex.com.tw/cht/3/futContractsDate),
[OpenAPI schema](https://openapi.taifex.com.tw/swagger.json), and
[government dataset 11596](https://data.gov.tw/dataset/11596).

A bounded public verification on 2026-11-06 returned 66 rows, 22 product groups
and source date **2026-11-05**. Content-Type was `application/octet-stream`, with
JSON content. The website was already dated 2026-11-06 and included a 23rd group,
Taiwan Mid-Cap 100. That cross-date difference is not proof of a same-day omission
or a new product launch. Successful retrieval does not establish that the API
has the latest exchange report. No source observations are committed or used as
fallback values. This public probe is not hosted production-data verification.

## Monetary meaning and product currency

Trading contract amount is the sum of execution price × contract multiplier ×
contracts. It is **contract notional turnover**, not option premium, margin,
settlement cash or funds entering the market. OI contract amount instead uses
daily settlement price × contract multiplier × OI. Do not combine futures
notional amounts and options premiums into one unlabeled monetary total.

The API does not include a currency property. The checked official product
specifications establish TWD for every allowlisted product, including the six
foreign-index contracts. Foreign underlying indices do not imply USD, JPY or GBP
contract currency. Stock/ETF aggregate currency and the same execution-amount
formula are explicit in [official monthly statistics](https://www.taifex.com.tw/cht/7/monthlyFutData).
The currency evidence does not apply to other products, FX, gold or oil.

Source `TradingValue(Long)(Thousands)` and `TradingValue(Short)(Thousands)` are
normalized by exactly 1,000 into TWD. No volume, quoted price, inferred multiplier
or FX rate is used to create the displayed monetary amount. Long/short here are
buy/sell transaction sides, not a bullish/bearish or capital-flow classifier.

Area defaults to the buy-side source amount; a local selector switches to the
sell side. The two sides are never added and called unduplicated turnover.
Sequential color encodes the same selected amount, not price change or flow
direction. A filter changes the disclosed denominator. Zero values occupy no
area and remain accessible in details; there is no equal/minimum-area substitute.
Counts, source signed nets and OI are separate details, not default area weights.
Reported nets may differ from separately rounded sides by one source thousand;
the original values are retained, never overwritten or called cash inflow.

## Coverage and validation

Use the explicit product/currency allowlist, not a fixed total of 22 groups.
Every source row must have the exact expected fields, safe canonical integer
strings, one valid report date and a unique product/institution key. Every
present product must contain exactly dealers, investment trusts, and foreign/
mainland investors. Unknown products are validated but excluded from monetary
areas, with excluded product/row counts shown. Missing allowlisted products are
not fabricated as zero. At least one supported product is required. At most
100 source product groups / 300 rows are accepted.

All source counts reconcile exactly. Monetary net reconciliation permits only
±1,000 TWD rounding. Zero count requires zero amount for that side, while a
positive count with a rounded zero amount is valid. All displayed aggregate
amounts remain within safe exact integer limits. Raw source strings cannot
become executable content or substitute for known product/currency definitions.

## Dates, sessions and usage rights

The daily institutional report includes the preceding night session and its
associated regular session, where applicable. It includes block trades and
foreign-underlying/offshore ETF transactions. It is not a day-session-only
statistic. See the [official notice effective 2021-12-06](https://www.taifex.com.tw/file/taifex/event/cht/newrule2021q4/file/%E5%8F%B0%E6%9C%9F%E4%BA%A4%E5%AD%97%E7%AC%AC1100201981%E5%87%BD-%E4%BA%A4%E6%98%93%E9%9D%A2%E6%B3%95%E8%A6%8F.pdf).
Approximate website publication times do not establish an API release SLA.
The API supplies no actual publication timestamp. HTTP Last-Modified is not
used as the economic report date or an established publication time.

The page displays report date and successful acquisition time separately;
`source_released_at` stays null. Cache older than one hour or report older than
four Taipei calendar days is stale. Cache older than 24 hours, report older than
14 calendar days, or future report dates are hidden. These are explicit app
limits, not a holiday calendar or a provider promise.

Dataset 11596 specifies daily, free access under [Government Open Data License
v1](https://data.gov.tw/license). Reuse, redistribution and derivative works are
permitted with source/license attribution. [TAIFEX terms](https://www.taifex.com.tw/cht/edu/userTerms)
exempt government-open-data-authorized datasets from the general reuse
restriction. Attribute TAIFEX and the Financial Supervisory Commission Securities
and Futures Bureau, dataset and license, without implying endorsement. No
account or separate explicit agreement acceptance was required for this dataset.
The existing private site's audience remains unchanged.

## Shared provider admission and complete cache

Futures and options share the **existing** `taifex_options_gate` row
`daily_institutions`. This change adds no migration, provider row or independent
request budget. Existing busy ownership, blocked status, payload and cooldown
are never reset or taken over. Other sources, including Deribit, remain separate.

Both pages use one provider instance and a fixed report projection. Snapshot
requests can collect only after the same atomic hourly admission. One bounded
batch requests options then futures sequentially, with at least 1.1 seconds
between request starts and one retained 25-second lifetime. The bounded public
futures probe took about 7.9 seconds for one GET; the two-source window allows
for that observed latency without increasing requests. The browser timeout
remains 30 seconds. No date scanning,
per-filter calls, endpoint fallbacks or unattended scheduler is added. The
inspected official sources document no numeric API quota; this conservative
application bound is not an official allowance or evidence of unlimited access.

The stored `taifex-institutions/2` bundle contains complete options and futures
reports. New successful writes are all-or-nothing. Their source dates may differ;
completeness, date regression and age are validated separately. Each page shows
only its report's actual acquisition times and date. The bundle acquisition
clock is not a source-publication clock and is not used to disguise older data.

Exact legacy `taifex-options-institutions/1` caches remain valid options-only
evidence with original clocks. Futures remains unavailable until the next
naturally allowed complete acquisition. Missing futures does not poison options,
shorten cooldown or create another source budget. Partial schema-2 caches are
invalid and cannot masquerade as legacy snapshots.

A denial, redirect, HTML challenge or HTTP 401/403/407/429/451 from either endpoint
blocks the original provider and atomically purges the entire cached bundle.
Both warm and cold pages suppress evidence during denial, busy or unconfirmed
admission. Ordinary transport, schema, age, regression or partial failures keep
the exact prior complete/legacy payload. There is never new options combined
with old futures. Retry-After cannot shorten the shared hourly minimum.

Prevalidate and serialize the entire candidate, including its UTF-8 byte size
against the unchanged 256,000-byte D1 bound, before entering the release phase.
Validation/size failure must release as temporary failure, not strand a busy
lease. Late D1 writes remain retained until settlement and are never retried
when outcome is uncertain. Transient inspection failure suppresses its current
response without poisoning confirmed warm cache; acquisition/release uncertainty
and denial remain enforced.

Both status APIs and the two source-diagnostic projections are read-only. The
options diagnostic recognizes old top-level and new nested clocks; futures
recognizes only its complete bundle. Legacy options never imply a futures cache.
No payload, lease or raw errors are exposed by diagnostics.

Older application code cannot parse the new bundle and will fail closed. A
rollback must retain the compatible reader. Clearing persistent state is not a
rollback strategy.

## Reproducible checks

Run the full unit/UI suite, lint, TypeScript and build. The offline native
`npm run test:taifex-options-runtime` exercises both current production report
handlers with synthetic data and all external network disabled. It covers
legacy and combined caches, one-provider admission, cross-page sharing,
compression, independent report dates, denial/partial failure and retained
cancellation/late writes. `npm run test:diagnostics-runtime` verifies both
metadata projections without writes or source requests. Schema generation must
report no changes; all existing migrations and unrelated provider rows remain
unchanged. Actual production data/browser layout requires a separate normal
authorized observation and is not proven by these offline checks.

## Official per-product TWD evidence

- [臺股期貨 (TX)](https://www.taifex.com.tw/cht/2/tX): TWD 200 per index point.
- [小型臺指期貨 (MTX)](https://www.taifex.com.tw/cht/2/mTX): TWD 50 per index point.
- [微型臺指期貨 (TMF)](https://www.taifex.com.tw/cht/2/tMF): TWD 10 per index point.
- [電子期貨 (TE)](https://www.taifex.com.tw/cht/2/tE): TWD 4,000 per index point.
- [小型電子期貨 (ZEF)](https://www.taifex.com.tw/cht/2/zEF): TWD 500 per index point.
- [金融期貨 (TF)](https://www.taifex.com.tw/cht/2/tF): TWD 1,000 per index point.
- [小型金融期貨 (ZFF)](https://www.taifex.com.tw/cht/2/zFF): TWD 250 per index point.
- [非金電期貨 (XIF)](https://www.taifex.com.tw/cht/2/xIF): TWD 10 per index point.
- [櫃買指數期貨 (GTF)](https://www.taifex.com.tw/cht/2/gTF): TWD 4,000 per index point.
- [富櫃200期貨 (G2F)](https://www.taifex.com.tw/cht/2/g2F): TWD 50 per index point.
- [臺灣永續期貨 (E4F)](https://www.taifex.com.tw/cht/2/e4F): TWD 100 per index point.
- [臺灣生技期貨 (BTF)](https://www.taifex.com.tw/cht/2/bTF): TWD 50 per index point.
- [半導體30期貨 (SOF)](https://www.taifex.com.tw/cht/2/sOF): TWD 50 per index point.
- [航運期貨 (SHF)](https://www.taifex.com.tw/cht/2/sHF): TWD 1,000 per index point.
- [東證期貨 (TJF)](https://www.taifex.com.tw/cht/2/tJF): TWD 200 per index point.
- [美國標普500期貨 (SPF)](https://www.taifex.com.tw/cht/2/sPF): TWD 200 per index point.
- [美國那斯達克100期貨 (UNF)](https://www.taifex.com.tw/cht/2/uNF): TWD 50 per index point.
- [美國道瓊期貨 (UDF)](https://www.taifex.com.tw/cht/2/uDF): TWD 20 per index point.
- [美國費城半導體期貨 (SXF)](https://www.taifex.com.tw/cht/2/sXF): TWD 80 per index point.
- [英國富時100期貨 (F1F)](https://www.taifex.com.tw/cht/2/f1F): TWD 50 per index point.
- [臺灣中型100期貨 (M1F)](https://www.taifex.com.tw/cht/2/m1F): TWD 10 per index point.
- [股票期貨 / ETF期貨](https://www.taifex.com.tw/cht/7/monthlyFutData): NTD amount and the same execution formula.
