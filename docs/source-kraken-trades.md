# Kraken executed-trade imbalance

## What this measures

The private `/crypto` page retains its full verified USD spot quote universe and
adds a **separate, bounded executed-trade matrix** for BTC/USD, ETH/USD and SOL/USD.
These are explicitly selected pairs, not all crypto markets or invented industries.
Only pairs present in the validated online USD spot catalog are requested.

For each pair, the adapter sums price × base quantity separately for
buy-marked (`b`) and sell-marked (`s`) executions, in USD. Difference is buy minus sell;
color is difference / (buy + sell), with a fixed ±100% scale and equal tile area.
Decimal products and sums use scaled integers, retaining up to 24 decimal places.
Presentation does not infer amounts from colors or round the stored evidence.

Each matched execution always has both a buyer and a seller. The source-side
imbalance is **not net capital entering the exchange or asset**, deposits,
withdrawals, cross-border transfers, investor identity, or global fund flow.
Amounts across pairs are not summed. Overlapping refresh snapshots must not be
accumulated into hourly/daily totals. No accounts, orders or paid subscriptions
are used, created or accessed.

## Official source contract checked 2026-11-05

- [Recent Trades](https://docs.kraken.com/api-reference/market-data/get-recent-trades)
  is the public REST `/0/public/Trades` endpoint. It accepts a pair, a `since`
  cursor/timestamp and up to 1,000 trades. Its documented example contains price,
  quantity, execution time, buy/sell marker, order type, miscellaneous data and
  trade ID, plus a string `last` cursor.
- [Advanced API FAQ](https://support.kraken.com/au/articles/advanced-api-faq)
  explains nanosecond `since` timestamps and using the returned `last` value for
  a subsequent page. Public methods do not need authentication.
- [Public trade field semantics](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/trade)
  explicitly identifies the WebSocket side as the taker order's side. However,
  the inspected REST OpenAPI only names its b/s field buy/sell, without explicitly
  confirming the initiator convention. This application uses REST, so its labels
  say source buy/sell-marked turnover and disclose that uncertainty. It does not
  claim that WebSocket documentation alone proves REST taker-side semantics.
  A future proven taker feed would need separate evidence and lifecycle review.
- [Public rate limits](https://support.kraken.com/ca/articles/206548367-what-are-the-api-rate-limits-)
  cover IP/pair limits for Trades. Kraken recommends at most one public REST
  request per second. The application spaces all public Kraken requests by at
  least 1.1 seconds and uses its existing shared admission gate.

Public accessibility is not a grant of market-data redistribution rights.
Existing personal access and source-use boundaries remain unchanged.

## Requested window, response limits and missingness

The request interval is `[acquisition start − 5 minutes, acquisition start)`.
All selected pairs share these exact millisecond boundaries, including when
requests execute sequentially. Responses can include trades after the interval
ended; these are counted as excluded, never added to that window's amounts.
Provider execution timestamps are numeric epoch seconds; displayed timestamps
retain millisecond resolution. Acquisition time remains separate from execution
time. The cursor is kept as text, not converted to a number or mislabeled as the
latest trade time.

Each pair gets **one page only**. Exactly 1,000 returned rows is potentially
truncated, even if the first/last times look recent. That row is explicitly
`capped_response`: all monetary totals and the color are null, never zero. There
is no page-following loop, fallback endpoint, backfill or hidden retry.

An under-cap result is called `uncapped_response`, **not a verified complete
window**. Values describe only the executions returned within the requested
interval. Source publication lag, missing source events or omissions cannot be
measured from this endpoint. The first/last returned execution, counts,
excluded-later count, request window and acquisition time are visible. Trade IDs
are required and duplicates are rejected; gaps between IDs are not interpreted
as lost trades because consecutiveness is not assumed.

A successful empty under-cap response contains observed zero returned turnover,
with no normalized imbalance/color. Neither direction is inferred from price moves
or the market/limit order-type field. An absent catalog pair is separately listed
as not requested. Invalid tuples, decimals, identity, order, side, time or clock
conditions fail collection rather than silently dropping executions. A temporary
failure retains the whole prior quote/trade collection as stale; it never mixes
new quote timestamps with old trade amounts.

## Lifecycle and operating cost

The deployed host opts into the trade subfeed. Existing quote-only fixtures and
older quote-only replies remain supported; trade data uses its own validated
`kraken-trades/1` schema alongside the unchanged `kraken-spot/2` quote contract.

- Warm collection: one ticker + at most three Trades GETs.
- Catalog refresh/cold collection: one AssetPairs + one ticker + at most three
  Trades GETs.
- One existing shared source lease, 1.1-second spacing, unchanged 12-second total
  acquisition deadline, cancellation handling and retained lease settlement.
- Existing one-minute success cooldown and browser checks while visible. There
  is no promise of subsecond streaming or unattended continuous collection.
- Existing 15-minute maximum cache display age. Stale/error status applies to
  both matrices; original acquisition/window times never move during failure.
- HTTP/API access denials, challenges and rate denials stop the whole shared
  Kraken source persistently. No alternate path, gate reset, extra credentials
  or lease takeover is introduced. No database migration is needed.

A busy/cold worker may have no usable in-memory snapshot during shared cooldown;
this iteration does not introduce shared observation storage. Neither source
latency nor absence of trades is used as a freshness guarantee.

## Architecture and verification

`protocol.ts` owns shared API error classification. `trades.ts` owns the bounded
source parser, exact amounts and window model. `trade-validation.ts` verifies
untrusted browser/cache data, amount identities, counts, coverage and coordinated
acquisition times. The existing handler owns acquisition and lifecycle; the
presentation adapter and shared `MatrixHeatmap` own no source fetching.

Tests use synthetic data only. Unit coverage includes exact decimals, boundaries,
cap handling, malformed/duplicate events, API denials, client tampering, expiry,
shared pacing, cancellation, stale atomic retention and the existing deadline.
The native workerd/D1 suite disables real networking and exercises the checked-in
host, compressed responses, three-pair budgets, caps and trade-source denial.
Local checks do not by themselves establish current provider availability.
