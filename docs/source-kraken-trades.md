# Kraken executed-trade imbalance

## What this measures

The private `/crypto` page retains its full verified USD spot quote universe and
adds a **separate, bounded executed-trade matrix**. BTC/USD, ETH/USD and SOL/USD
are the default; the owner can select one to three catalog-confirmed USD pairs.
These are explicitly selected pairs, not all crypto markets or invented industries.
Only pairs present in the validated online USD spot catalog are requested.

For each pair, the adapter sums price × base quantity separately for
buy-marked (`b`) and sell-marked (`s`) executions, in USD. Difference is buy minus sell;
color is difference / (buy + sell), with a fixed ±100% scale. Tile area is the
absolute USD difference across the same fixed stored window. Zero and missing
amounts receive no invented area; accessible details keep them distinct.
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

The request interval is `[acquisition start − selected duration, acquisition start)`.
The owner can select one minute or five minutes; five minutes remains the default.
`window=1m` and `window=5m` are the only allowed timeframe values. The response
echoes an explicit request as `requested_window`; `window_ms` must match the
selected duration and exact stored start/end. The quote universe remains USD.
Canonical pair selection **and timeframe** identify trade cache evidence. Changing
either selector clears browser trade evidence immediately, retains independent
quotes, ignores prior-scope responses, and does not abort/restart in-flight source
work. Concurrent readers cannot receive another selection/window's trade rows.
Switching windows does not bypass shared cooldown, even if no matching data exists.
All selected pairs share these exact millisecond boundaries, including when
requests execute sequentially. Responses can include trades after the interval
ended; these are counted as excluded, never added to that window's amounts.
Provider execution timestamps are numeric epoch seconds; displayed timestamps
retain millisecond resolution. Acquisition time remains separate from execution
time. The cursor is kept as text, not converted to a number or mislabeled as the
latest trade time.

Each selected pair gets at most **two pages of 1,000 trades**, within the same
shared source lease, spacing and 12-second acquisition deadline. Every pair gets
its first page before any continuation; only a full page is continued. The next
request uses the returned string cursor exactly. Nonempty continuations must
advance the cursor strictly; an empty terminal page may repeat it but cannot
rewind. Cursor timestamps must remain within the acquisition time bounds. Cursor
and final execution time remain distinct, and need not be equal.

Cross-page duplicate trade IDs or reversed execution times fail the collection,
rather than being silently deduplicated or dropped. A full **terminal** page is
still `capped_response`: all monetary totals, monetary area and directional color
are null, even if the requested duration is only one minute or the last trade
falls after the interval end. No full-window completeness is inferred. The page
limit is not automatically increased and there is no fallback endpoint, backfill
or hidden retry. The response exposes `page_limit`, `page_count`,
`last_page_count`, cumulative returned count and the unchanged per-page
`trade_limit`. The browser verifies their arithmetic and the null-capped rule.

A short terminal page, including after one bounded continuation, is called `uncapped_response`, **not a verified complete
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
`kraken-trades/1` (default pairs) or `/2` (explicit pair selection) contract alongside
the unchanged `kraken-spot/2` quotes. The browser accepts legacy single-page
five-minute records without pagination metadata. New pagination metadata is
validated as a unit; it cannot turn a capped terminal page into a numeric total.

- Warm collection: one ticker + at most six Trades GETs (two per pair).
- Catalog refresh/cold collection: one AssetPairs + one ticker + at most six
  Trades GETs. A short first page does not cause a second request.
- One existing shared source lease, 1.1-second spacing, unchanged 12-second total
  acquisition deadline, cancellation handling and retained lease settlement.
- Existing one-minute success cooldown and browser checks while visible. There
  is no promise of subsecond streaming or unattended continuous collection.
- Existing 15-minute maximum cache display age. Stale/error status applies to
  both matrices; original acquisition/window times never move during failure.
- HTTP/API access denials, challenges and rate denials stop the whole shared
  Kraken source persistently. No alternate path, gate reset, extra credentials
  or lease takeover is introduced. Shared storage requires appended migration
  `0017_kraken_shared_snapshots.sql`, without modifying the admission gate.

A cold worker can now reuse the validated selected quote/trade cohort from
primary D1 during shared cooldown. Busy/denied/unknown permission states suppress
evidence. At most 16 selections plus the latest fallback are retained; original
window/fetched timestamps and the 15-minute expiry never change on a cache read. Neither source
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
host, compressed responses, three-pair/two-page budgets, one/five-minute cache
isolation, caps and trade-source denial.
Local checks do not by themselves establish current provider availability.


## Saved actual observations inspected for this change

Previously acquired, normally gated snapshots were reviewed offline. On
2026-11-05, the five-minute BTC window ending at 12:00:46.867 UTC returned 477
trades (469 inside the fixed interval); the saved selection window ending at
14:19:54.918 UTC returned
41 ADA and 62 XRP trades. These were uncapped. The 1,000-row risk is therefore a
bounded-source limitation, not a claimed failure observed in those snapshots.
No new provider call was made for implementation or local tests. Deployment-time
checks must use the normal source gate and preserve any busy/blocked/cooling state.

## Organized current-view export (iteration 89)

The `/crypto` page now provides a collapsed, read-only evidence panel and a local
JSON file after its existing trade heatmap. It exports only the current validated,
permission- and age-safe selected trade snapshot. Exact native USD decimal strings,
numeric truncated percentage, pair identity, fixed window, coverage/counts and
per-pair/final fetch clocks remain unchanged. Missing catalog pairs get no invented
metadata; capped nulls, empty-window zero strings and null ratios stay distinct.
Every execution has buyer and seller counterparties, and b/s marked imbalance is
not net capital inflow. The existing source contracts, request budget, endpoints,
store, gates and permissions do not change. See
[organized current-report evidence](organized-report-projection.md#kraken-usd-trade-direction-evidence)
for field provenance, schema-1 defaults, click guards and Blob lifecycle details.
