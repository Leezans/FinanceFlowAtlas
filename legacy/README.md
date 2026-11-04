# FinanceFlowAtlas

An experimental cross-market research interface. It does **not** deliver comprehensive real-time global capital flows or validated trading signals. No brokerage connection or order execution exists.

## Implemented data layers
- Japan Ministry of Finance weekly cross-border portfolio securities transactions. Residents' foreign securities purchases and nonresidents' Japanese securities purchases are shown separately. Unit: JPY 100 million. Positive means net acquisition, negative net disposition. This is a designated major-institution reporting series, not all international capital flows.
- Binance BTC/ETH/SOL USDT spot complete 1-minute klines. Last 60 complete minutes: taker-buy quote volume versus the remainder. Difference is an aggressor-direction **proxy**, not cash inflow/outflow or investor-country attribution.
- Separate optional daily price context for US-listed regional/asset ETF proxies and crypto. Yahoo adjusted close is not an executable quote or a measure of flow.

## Time and availability
Minute gaps are rejected. Data older than 3 minutes is marked stale. Optional 60-second refresh operates only while the page is open. There is no background daemon, historical database or alert service. Weekly values are delayed and may be revised. Missing markets are marked as not connected. ETF daily prices exclude the current UTC date; crypto excludes incomplete candles.

## Coverage gaps
Most countries' actual flow series, FX transaction flow, futures positions/flow, individual-country allocation, valuation, trade execution, historical point-in-time releases and full real-time feed licensing remain unimplemented.

## Development
Requires Node 18+ for built-in fetch and Response support. No runtime npm dependencies.

- `npm test`: deterministic parser, arithmetic, error-handling and page-script syntax checks using synthetic fixtures.
- `npm run dev`: local HTTP adapter, port 3000 or the PORT environment variable. The adapter listens on all interfaces; use only in a trusted development environment or adapt the binding to your deployment requirements.

Application source is `worker/index.js`, which exports a standard Worker-style fetch handler. Production deployment, authentication and access control are the deployer's responsibility. No provider credentials, hosting identity, captured market datasets or access tokens are included.

## Validation boundaries
Automated tests cover selected parser and arithmetic cases, not all failure modes. They do not establish profitability, complete financial coverage or reliable production execution. Live providers may be unavailable, throttled or change their response formats. The interface must display missing or stale data rather than invent replacements. Authenticated hosted interaction and mobile layout have not been independently verified.

## Licensing and external data
The repository's Apache-2.0 license covers this source code only. It does not grant rights to third-party market data, trademarks or APIs. Before running, displaying, caching or redistributing provider data, review each provider's current terms and obtain any required permission. Public endpoint accessibility does not imply unrestricted redistribution rights. This project is not affiliated with the data providers and is not investment advice.
