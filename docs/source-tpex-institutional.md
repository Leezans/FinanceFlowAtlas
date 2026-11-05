# TPEx institutional share-trading industry matrix

## Scope and source decision

This source is **Taiwan TPEx OTC listed companies**, not TWSE-listed companies,
not the entire Taiwan securities market and not global monetary capital flows.
`/taiwan` shows institution-specific net purchases/sales **in shares**, grouped
by the official company industry classification. No prices are used to invent
cash amounts. It offers three institutions together, foreign/mainland investors
excluding foreign dealers, securities investment trusts, and dealers.

TWSE T86 is intentionally not acquired. On 2026-11-05, the official TWSE OpenAPI
specification contained 143 paths but no per-security institutional flow endpoint.
TWSE website terms section 6 restrict unapproved automated downloads; section 8
exempts data explicitly released through the government open-data platform from
its general reuse restrictions. We did not verify an open-data grant for T86.
The official information shop separately sells its three-institutional files,
including an external-use tier. Anonymous website access alone is not an open
license. No alternate-host scraping, auth, account creation or license purchase
was performed.

- [TWSE OpenAPI specification](https://openapi.twse.com.tw/v1/swagger.json)
- [TWSE website terms](https://www.twse.com.tw/zh/terms/use.html)
- [TWSE institutional data product](https://eshop.twse.com.tw/zh/product/detail/c4c87ac184e44896a05fcab5a9d544ec)

## Separately verified TPEx data and rights

Both datasets are free, daily datasets explicitly registered under the
[Open Government Data License version 1.0](https://data.gov.tw/license):

1. [Institutional share trading, dataset 11856](https://data.gov.tw/dataset/11856)
   → `https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading`
2. [OTC company master, dataset 25036](https://data.gov.tw/dataset/25036)
   → `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O`

The government metadata for both links the
[official TPEx OpenAPI specification](https://www.tpex.org.tw/openapi/swagger.json).
The specification contained 225 paths at verification. Both fixed JSON endpoints
returned 200 without credentials, cookies, API keys or an account from the coding
runtime. This is **not** evidence that the deployed host has already accessed them.

The OGDL grants use, adaptation and redistribution subject to attribution. The UI
names the Financial Supervisory Commission Securities and Futures Bureau / TPEx,
the two datasets and applicable observation year, and links both source metadata
and the license. It labels industry joins/aggregations as this application's
calculations, with no source endorsement. Raw company-address/contact/officer
fields are discarded; no user information is sent to these endpoints. No source
observations are committed to Git. Tests contain synthetic observations only.

Industry labels are facts separately verified against TPEx's
[IP market-information specification v5.4l, 2025-05-13](https://dsp.tpex.org.tw/storage/eb_data/11405/1140500476-1.pdf),
industry-code table, and corroborated by
[post-close format specification v1.33, appendix 1, page 152](https://www.tpex.org.tw/storage/regular_system/%E6%96%B0%E7%89%88%E6%94%B6%E5%B8%82%E5%BE%8C%E4%BA%A4%E6%98%93%E8%B3%87%E8%A8%8A%E6%A0%BC%E5%BC%8F%E8%AA%AA%E6%98%8E%28V1.33%E7%89%88%29.pdf?t=20251127).
This verifies code meanings, not rights to the separate quote feeds described in
those documents. Unknown future codes retain their supplied code and display
“name unverified”; no label or membership is guessed. Older removed codes 18/34
are not filled from a generic TWSE mapping.

## Verified access and join evidence

The production parser was run against the two actual no-account responses on
2026-11-05 at 07:06:37 UTC. Both report dates were ROC `1151104`, converted and
calendar-validated to **2026-11-04**:

- 918 rows in the institutional securities response.
- 897 rows in the official company master, spanning 28 industry codes.
- 797 exact security/company-code joins.
- 100 company-master rows absent from the institutional report, retained as null.
- 121 security rows without company classification, excluded from industry sums.
- All returned participant buy/sell/net identities and three-institution totals
  passed integer, nonnegative-buy/sell and arithmetic balance checks.

These are observed response/join counts, not a claim that every listed security
had a trade or that a missing row means zero. The official endpoints return a
whole JSON array with no pagination/row-total fields; this adapter reads every
returned row but cannot independently prove the source's exchange-wide
completeness. It never fills an omission or truncates a top-N ranking into a
claimed full market.

## Contract and UI

- Stock membership is an exact join on `SecuritiesCompanyCode`.
- Company classification and trading reports must each have one valid date and
  the dates must match. Mixed dates, duplicates, malformed values, empty sources,
  no matching companies and arithmetic errors reject a candidate snapshot.
- Three-institution total = foreign/mainland **excluding foreign dealers** +
  investment trusts + dealers. Foreign dealers already belong to dealers;
  adding them again would double count. Each reported net must equal buy minus
  sell; the total must match the sum. The provider's similarly named ancillary
  dealer fields are not substituted for the exact verified total fields.
- Missing company observations remain null. Genuine numeric zeros remain zero.
  Securities without a company industry are counted but not assigned a class.
- Initial tiles are equal-area industries. Selecting an industry shows equal-area
  company tiles, including missing rows, with keyboard access and complete exact
  numeric details. Participant changes and refreshes preserve current selection.
- Color is net shares / (buy shares + sell shares), fixed from −100% to +100%.
  Reported zero activity is neutral; missing is gray. Industry quantities are
  simple sums over reported companies and disclose partial coverage. They are
  not weighted by stock price, market cap or economic size, nor monetary flows.

## Acquisition, persistence and time

An independent D1 gate shares the normalized public snapshot. It does not read,
reset, migrate over or reuse any A-share/TWSE/Sina/FX/crypto/CFTC acquisition lease.
Apply appended `0007_tpex_institutional_gate.sql` via the authorized deployment
workflow. Existing gate states remain unchanged, including blocked or busy gates.

The server reads the fixed flow endpoint then the fixed company endpoint, each
with credentials omitted, manual redirects, a decoded 4 MB body budget and a
shared 25-second acquisition deadline. Only JSON is accepted. Access denial,
rate-limit/challenge or redirect atomically blocks this source and clears its
public cache. No second endpoint is requested after the first is denied. No
alternate endpoint, lease takeover or automatic reset exists.

Success is cached one hour. Temporary failures retain valid last-good evidence,
honor longer Retry-After and back off. D1 admission and settlement are retained
through the worker request lifetime, including request cancellation and late
writes; missing lifetime support fails closed. Shared snapshots are revalidated
on each read. Busy/unknown coordination never initiates concurrent collection.
Date regression does not replace a newer report.

Observation date is a Taipei calendar date. Acquisition time is separately UTC;
the official API does not provide actual publication time. Report age over four
days is stale, and over fourteen days is hidden. Cache age over 24 hours is also
hidden, independently in server/browser; another failed fetch cannot renew it.
These are application safeguards, not official release SLAs. No historical
backfill/date-query support is inferred from the latest-snapshot endpoints.

## Validation

- Focused unit/component tests cover exact joins, all participants, missing/zero,
  industry drilldown/back, keyboard selection, retained selections, permission
  clearing, duplicate clicks, cancelled requests, report/cache expiry and stops.
- `npm run test:tpex-runtime` runs the checked-in host in native workerd/D1 with
  all external network disabled, synthetic plain/gzip/Brotli payloads, distinct
  warm/cold workers, cooldown, stale cache clearing after denial, cancellation
  settlement, and unchanged prior gates.
- Live response validation above is from the coding runtime, not the deployed
  website. Deployment, migration and authenticated browser QA are separate steps.
