# Country-owned market evidence

`/markets` is no longer a Treasury TIC counterparty matrix. Its country selector
opens evidence about the selected country's own market. The optional geography
map shares the country URL and supports Back/Forward. Source panels unmount when
the country changes, so outstanding responses cannot populate a different market.
Only the selected source is requested. The independent U.S. TIC supplement is
collapsed and does not load until explicitly opened.

The 249 searchable geographic entries are not 249 connected markets. The current
three source entries are China (provider-classified main-net estimates, CNY),
Taiwan OTC (daily institutional monetary summary, TWD), and Brazil (monthly
publicly disclosed fund equity trades, BRL). Source entry availability is distinct
from data availability. All other countries, including the U.S., retain a real
empty industry-money-flow canvas. There are no country placeholder amounts,
missing-to-zero conversions, cross-currency totals, or world net-flow estimates.

## Metric and time boundaries

Matched secondary-market transactions always have a buyer and seller. A nonzero
net-trading measure must identify an investor population or order classification.
None of these panels claims whole-market cash creation or national capital flow.
No prices, turnover, holdings changes, FDI, or international balance-of-payments
series are silently substituted for the requested market net buying.

China retains the existing source-specific timing and access controls. A
one-minute application check is not proof of one-minute source updates. Brazil
is explicitly monthly, not a live source; its existing disclosure lag and
partial/confidential coverage remain visible. IMF BOP remains outside this
hosted view: its quarterly/annual observations are not intraday market flow and
the independent Python adapter's unresolved unit gate is unchanged.

## Taiwan monetary summary

- Official [dataset 11743](https://data.gov.tw/dataset/11743) is daily, free and
  licensed under [Taiwan Open Government Data License v1](https://data.gov.tw/license).
- The sole fixed API is
  `https://www.tpex.org.tw/openapi/v1/tpex_3insti_summary`.
- Exact fields are `Date`, `Investor`, `PurchaseAmount`, `SaleAmount`, and `Net`.
  All eight raw lines and the foreign/dealer/overall accounting balances are
  verified. Published ROC dates become ISO dates; publication time is unknown.
- Amounts are native new Taiwan dollars, not millions. The official historical
  [summary table](https://www.tpex.org.tw/web/stock/3insti/3insti_summary/3itrdsum_result.php?d=111%2F07%2F01&l=zh-tw&o=htm&p=1&t=D)
  labels the three amount columns in 元. This evidence was obtained from indexed
  official content; a rejected page was not retried or bypassed.
- The matrix contains foreign/mainland investors **excluding foreign dealers**,
  investment trusts, and dealers. The separately displayed total is not a fourth
  overlapping area. The parser checks foreign dealer and dealer proprietary/hedge
  sublines but does not add them again.
- Scope is the source's official OTC institutional securities summary, not all
  Taiwan, the TWSE listed market, common stocks only, or industry amounts. The
  exact current security-type decomposition is not supplied in this response.
- The independent existing company/industry report is in **shares**. It is
  optional and clearly separated. No monetary summary is allocated into industry
  amounts by share ratios, closing prices, or inference.

Source lookup established the API schema but does not authorize bypassing the
existing deployed TPEx access stop. See [runtime boundaries](tpex-summary-runtime.md).
The new adapter remains empty while that authoritative provider state is blocked.
No provider reset, source switch after denial, or live deployed availability is
claimed by this change.

## Architecture and verification

`lib/national/tpex-summary.ts` owns pure source schema/parser;
`lib/national/tpex-summary-view.ts` owns browser validation and monetary projection;
`lib/reports` owns generic transport/cache/lifetime coordination;
`components/markets` owns country selection and source composition. The shared
amount matrix renderer handles local-currency proportional geometry. Existing
country workspaces are reused rather than duplicated.

Synthetic tests cover country identity, explicit TIC opt-in, empty unknown
markets, deep links and Back/Forward, no stale cross-market response, participant
subtotal exclusion, zero geometry, cache/report expiry, invalid schemas,
permission failure and provider-level denial/cooldown. Native workerd/D1 tests
run with external networking disabled. Release QA separately exercised the actual
components with synthetic fixtures at desktop and 390px widths: country identity,
search/map/history, empty unsupported countries, explicit TIC open/close,
participant detail, 2:1 monetary area, status variants and no horizontal overflow.
This is offline browser QA, not live-provider or physical-device verification.
