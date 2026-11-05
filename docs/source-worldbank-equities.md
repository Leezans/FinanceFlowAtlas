# World Bank / WFE annual equity context

## Scope and semantics

`/equities` is a separate annual country-market size and liquidity layer, with
USA selected initially. It does not provide industry/stock money flow. TIC's
actual monthly cross-border transactions remain a separate linked view.

- `CM.MKT.LCAP.CD`: year-end market capitalization of listed domestic companies,
  excluding investment funds, unit trusts and share-holding companies. A stock,
  not a flow.
- `CM.MKT.TRAD.CD`: annual shares traded times corresponding transaction prices,
  single-counted, including domestic and foreign shares. Turnover, not net buying.
- Both are current USD. Official metadata describes conversion at corresponding
  year-end exchange rates. Do not subtract the indicators or infer investor flow.
- Select each country's latest non-null observation independently per indicator,
  within the last three completed years. Compare only observations from the
  newest available year for the selected indicator. Do not mix years or infer a
  global total from incomplete/differing coverage.
- Exclude region/income aggregates by exact ISO registry matching, and require
  matching ISO2. Null stays missing; reported zero stays zero. Searchable geography
  is not a promise of observation coverage.

## Matrix presentation boundaries

- `lib/equity/matrix.ts` is a pure source-specific projection to the shared
  `MatrixGroup` contract. It selects only the latest available year per metric,
  creates explicit missing geographic slots, and never synthesizes flow or totals.
  Historical-year selection is intentionally unavailable because the stored
  snapshot retains each country's latest non-null observation, not full history.
- The region → country matrix has 249 geographic slots with separate verified
  coverage counts, no top-15 truncation, and equal-width readable country tiles.
  Every source-year value and original precision remain keyboard accessible.
- Opt-in sequential blue bands show nonnegative size/turnover magnitude only.
  Existing signed palettes are unchanged. Regional filters retain the full
  source-year scale. Reported zero and missing observations remain distinct.
- Country detail uses a separate, neutral, two-metric matrix. Each metric keeps
  its own latest year and scope; the two measures are not combined or ranked.
- `hooks/useEquitySnapshot.ts` owns browser request/permission/cancellation and
  expiry handling. `EquityMatrix.tsx` owns local presentation filters. Neither
  the pure projection nor shared renderer performs source acquisition.
- `MatrixHeatmap` retains fixed grid column widths across regions by default.
  Only the single country-detail group opts into stretching its two metric tiles.

## Official source and reuse evidence

Verified 2026-11-05:

- [Market capitalization](https://data.worldbank.org/indicator/CM.MKT.LCAP.CD)
- [Stocks traded value](https://data.worldbank.org/indicator/CM.MKT.TRAD.CD)
- [API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [World Bank data terms](https://data.worldbank.org/summary-terms-of-use)

Both specific indicator pages explicitly label **CC BY 4.0** and name the World
Federation of Exchanges (WFE). World Bank's terms permit copying, distribution,
adaptation, display and API use without charge, including commercial purposes,
subject to attribution and its additional dispute-resolution terms. The UI
attributes World Bank / World Development Indicators / WFE, links these indicator
and terms pages, and disclaims source endorsement of our filtering/visualization.
This permission is specific to these indicators, not all WFE products or all
third-party datasets in the World Bank catalog.

Requests need no account, key, cookies or credentials. No login, CAPTCHA, proxy,
browser impersonation, alternative origin or denial bypass was used.

## Actual retrieval evidence

On 2026-11-05 ordinary HTTPS GETs returned HTTP 200 / application/json for USA
and all-country 2024–2025 data, both official indicator metadata records (WDI
source `2`), and the exact implemented three-year request:

`https://api.worldbank.org/v2/country/all/indicator/CM.MKT.LCAP.CD;CM.MKT.TRAD.CD?source=2&date=2023:2025&format=json&per_page=5000`

That response completed in 23.47 seconds with 391,758 bytes. SHA-256:
`0f05ef47caa0190c10850e1bfc5cd9b4c78e035cb9f761eea8281217a372b647`.
The checked-in adapter accepted it: one complete page of 1,596 records including
aggregates/nulls; dataset `lastupdated=2026-10-08`; 74 countries with at least one
latest observation in the window; 68 countries with 2025 market cap, 69 with 2025
traded value. USA had both 2025 values. Counts describe this retrieval, not fixed
production coverage. Raw observations are not committed.

`lastupdated` is dataset-level, not verified per-row publication. We leave
`source_released_at=null`, and distinguish acquisition/fetch time from the annual
observation period. Research-runtime access does not establish availability from
a later production deployment.

## Acquisition and deployment

- Fixed official origin and two indicator IDs; last three completed years;
  complete single page only; maximum 5,000 rows / 1 MiB decoded / 30 seconds.
  Strict JSON, values, units, statuses, years, codes and duplicates are validated.
- Independent `worldbank_equity_source_gate` / `annual_equity` cache. Apply
  appended **0011_worldbank_equity_cache.sql** after 0010 using the supported
  deployment workflow. No prior source gate is modified.
- Atomic success snapshot plus one-day cooldown; cold-worker shared cache;
  temporary-failure backoff and Retry-After. Browser/server stop displaying cache
  older than seven days. Transport freshness never makes annual data real-time.
- Denial, redirect or challenge clears cache and durably stops acquisition.
  Busy/blocked gates do not expire or reset. Uncertain DB results fail closed.
  No lease takeover or source switching. Request lifetime retains late owned
  admission/release settlement. Browser interruption cancels and ignores late UI
  updates.
- `/api/v1/equities/status` is read-only and never initiates acquisition.
  `/api/v1/equities/snapshot` rejects arbitrary query parameters.
- Preserve the existing private/owner-only deployment boundary.

Tests contain invented values isolated from production. `npm run test:equity-runtime`
uses native workerd/D1 with real networking disabled. It covers plain/gzip/Brotli,
cross-worker cache and cooldown, corruption, durable denial and unchanged prior
gates. Adapter, handler and UI tests cover missing/zero values, annual semantics,
interrupted navigation, late settlement and browser/server expiry.

## Other researched candidates

- **US SEC:** the [official ticker/exchange JSON](https://www.sec.gov/files/company_tickers_exchange.json)
  was readable. [SEC guidance](https://www.sec.gov/about/webmaster-frequently-asked-questions)
  permits reuse of government/EDGAR material and fair automated access up to 10
  requests/s with declared User-Agent. APIs require no key. Useful reference,
  SIC and fundamentals, not quote/turnover or stock fund flow. A US listing does
  not prove US domicile. The tested submissions endpoint was inaccessible through
  the research tool; no workaround was attempted.
- **US Cboe:** its [daily market-volume CSV](https://cdn.cboe.com/resources/us/equities/market-statistics/historical-market-volume/market_history_2026.csv)
  was readable through 2026-11-04, with shares, notional and trades. These are
  turnover, not flows. An attribution sentence does not establish open licensing;
  [terms](https://www.cboe.com/terms) and [content policy](https://www.cboe.com/use-of-content)
  restrict storage/display and require licensing. Not integrated as open data.
- **US FINRA:** APIs require credentials and [specific equity reuse terms](https://developer.finra.org/specific-terms-equity-data).
  [Website terms](https://www.finra.org/terms-of-use) restrict database creation
  and bulk extraction. Short-sale volume also is neither whole-market flow nor
  short interest. Not integrated under the no-account/open-license requirement.
- **Taiwan TWSE:** the official government catalog lists [daily stock OHLC and
  turnover](https://data.gov.tw/dataset/11549) as free, daily and under Open
  Government Data License v1, linking TWSE OpenAPI. A normal GET of
  `https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` returned HTTP 200 /
  application/json on 2026-11-05, 322,210 bytes in 6.73 seconds, 1,390 security
  records all dated ROC `1151104` (2026-11-04). Fields include Date, Code, Name,
  TradeVolume, TradeValue, OpeningPrice, HighestPrice, LowestPrice, ClosingPrice,
  Change and Transaction. SHA-256:
  `710642546de265ad3d5d1334e0c43ff7ba272546b2bd7f10d7b2f289c0fde766`.
  This includes funds/ETFs as well as stocks, so security classification is needed
  before claiming an equities-only universe. The daily quote/turnover source is
  promising but is not production-integrated here, and is never net fund flow.

This pass found no fully qualified open-licensed, account-free US daily
stock/industry quote/turnover feed. Do not fill that gap with synthetic values or
convert this annual country context into stock/industry money flow.
