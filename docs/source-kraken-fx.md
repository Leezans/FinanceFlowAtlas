# Kraken fiat spot matrix: bounded intraday slice

## Verified source and scope

Checked 2026-11-05. Kraken's official endpoint documentation describes public historical and live
market-data access without an account or API key:
https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-

One ordinary AssetPairs read at 16:42:43 UTC returned HTTP 200 and online metadata
for AUD/USD, EUR/USD, GBP/USD, USD/JPY, USD/CAD, USD/CHF and EUR/GBP. This check
verified pair existence only, not price freshness. No ticker, trade, OHLC or
WebSocket live probe was performed for this change. After coordination requested
no direct provider probes, no further market-data call was made.

The implemented slice is only AUD/USD, EUR/USD and GBP/USD, whose exact metadata
identities are AUDUSD, ZEURZUSD and ZGBPZUSD. Both sides are fiat currencies,
confirmed by Kraken's published FX markets and pair metadata. No stablecoin,
crypto, inverse-rate or synthetic cross is silently substituted. Other Kraken
FX pairs and the wider wholesale/OTC foreign-exchange market are not covered.
https://www.kraken.com/in/features/forex-trading-markets
https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs

A source repository or library license does not grant data redistribution
rights. The existing personal, owner-only access boundary is unchanged. This
change adds no account, credentials, trading function or public data export.
Public endpoint eligibility is separate from permission to redistribute data.

## Architecture and request budget

This is a typed projection, not an independent acquisition adapter. The existing
Kraken universe already contains these USD-quoted spot pairs. The new view uses
the same singleton handler and source admission as the crypto view with
`pairs=AUD/USD,EUR/USD,GBP/USD` and the existing one/five-minute trade window.
There is no new upstream endpoint, source request path, migration or database
schema. `lib/fx/venue.ts` selects the bounded identity-checked fiat slice only
after the common browser validator/expiry boundary. No raw source snapshots are
committed.

The extracted `useKrakenEvidence` hook serves both views. All previous crypto
protocol defaults, validation, races and expiry behavior remain. Source data is
shared process-locally; cross-worker D1 admission and denial remain shared. This
change does not introduce durable shared quote storage or a second gate.

A cold admitted acquisition may request one catalog, one ticker, and at most six
trade pages total, not six pages per currency. The existing 12-second deadline,
1.1-second request spacing, 60-second shared quiet interval and 15-minute display
expiry remain unchanged. Another pair/window selection during cooldown may show
the shared quotes but has no trade evidence until its own allowed acquisition.
Concurrent readers do not launch another acquisition while one is pending.
Denials and uncertain permission state are not reset or bypassed. ECB only mounts
when the owner selects its separate daily-reference view; it is never an automatic
replacement for missing venue rates.

## Units, color and times

- `c[0]`: last traded rate, USD per one unit of AUD/EUR/GBP. No quote timestamp.
- `p[1]`: rolling-24h volume-weighted traded rate, same unit.
- `v[1]`: rolling-24h quantity in the base fiat currency, not USD or net flow.
- `t[1]`: rolling-24h trade count.
- Color: `(last rate / rolling-24h VWAP - 1) * 100`. This is a calculated
  comparison with VWAP, not a daily or fixed-window return. Other metrics are
  neutral. All rate tiles have equal area; different currency denominations do
  not imply comparable capital sizes.
- `fetched_at`: completed acquisition, never source observation time. The quote
  source clock and source latency remain null/unknown.
- Trade tuple time: executed-trade time, shown separately only for matching pair,
  fixed window and acquisition. A full terminal page remains capped/possibly
  truncated. Even uncapped responses are not described as globally complete.
- No returned trades means there is no execution timestamp; it is not fabricated
  from the fixed window, cursor, request time, or current clock.
- A trade timestamp does not timestamp the separately acquired ticker rate and
  is not advertised as the venue's latest execution. Minute checks do not prove
  minute latency. Production source freshness still requires observation.

Official field references:
https://docs.kraken.com/api-reference/market-data/get-ticker-information
https://docs.kraken.com/api-reference/market-data/get-recent-trades

## Checks

Unit/UI fixtures are synthetic. Coverage includes exact fiat identities,
crypto/stablecoin exclusion, missing data vs zero, quote/execution clock separation,
wrong-window/pair rejection, stale expiry, HTTP/source denial, tab unmount and
source separation, repeated metric changes, and minute refresh. Existing crypto
selection/window/race tests exercise the shared hook unchanged. Native workerd
Kraken tests use blocked external networking and retain the same D1 source gate.
Live availability or authenticated production freshness is not inferred from
these offline checks.

Final local validation: 1,492 tests across 96 files, TypeScript, ESLint and the
production build passed. The existing native Kraken suite passed all 12 scenarios
with external networking disabled. Independent review found no blockers. Visual
browser QA remains unverified: local Chromium could not create its socket even
with the supported escalation, and the cloud browser could not reach the local
synthetic preview. Integration must verify the rendered private preview.
