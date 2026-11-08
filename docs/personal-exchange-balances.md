# Personal tracked exchange balance research

This optional experiment lives at `/crypto/exchange-balances`. It is deliberately absent from public navigation and production always renders a disabled notice. To inspect locally, set `FFA_PERSONAL_EXCHANGE_BALANCES=1` when running the site's development server on localhost. Do not expose that development server publicly. The browser also refuses the feature unless its URL hostname is exactly localhost, 127.0.0.1 or [::1]; development preview hostnames are disabled.

## Source and permission boundary

- Official free endpoint: https://api.llama.fi/protocol/binance-cex
- Documentation: https://api-docs.defillama.com/llms-free.txt (`GET /protocol/{protocol}`, no API key)
- Terms reviewed 2026-11-07: https://defillama.com/terms (effective 2025-06-24). Personal/non-commercial access is distinct from permission to republish, mirror or commercially use provider data. This experiment does not grant those rights. Review current terms before use; public deployment needs a separate permission review.
- A browser-only request begins only after explicit personal-use acknowledgement. No application-server proxy, API credentials, background jobs, exports, storage or bundled provider payload. Tests use invented data. CORS or access failures stop without fallback. Each mounted page allows one attempt, with a 30-second timeout. No hourly polling or provider SLA is claimed.

## Metric contract

The result is an **estimated change in tracked wallet native asset balances**, not market investment flow, purchases, gross deposits, transaction-verified net transfers, Binance total reserves, or solvency evidence. Tracking changes, rebases, internal wallets and provider revisions can affect it. The inspected Binance methodology includes proof-of-reserves wallets, Binance-pegged token backing and known Ethereum staking withdrawal addresses, while excluding the Recovery Fund. This is broader than a clean customer-deposit perimeter.

Only the latest two consecutive UTC-midnight native snapshots strictly before the current UTC day are compared. Thus today's midnight and intraday tail are both excluded. This intentionally sacrifices freshness rather than passing a partial day off as complete. There is no calendar zero filling or gap interpolation. The UI shows exact start/end, latest source snapshot and retrieval timestamps; historical results are never described as live. The source's latest timestamp is not its publication time or an update guarantee.

Per source label:

- Native quantity change = ending quantity − starting quantity, only when both exist.
- End-price USD estimate = native quantity change × (ending USD valuation / ending native quantity).
- USD valuation must match the exact ending timestamp and label. Missing values and zero ending quantities have no derived price. Missing assets remain unknown, not zero.
- This USD estimate differs from the change in USD-valued balances, which includes market price movements. It does not reconstruct transaction-time valuation.

Provider labels are not verified contract identifiers. Current chain names do not establish historical wallet coverage. Added/removed labels are flagged, and matching labels do not prove constant coverage. No cross-token quantity sum or exchange-total flow is produced.

## Integration and verification

The feature is isolated from existing Kraken trades, matrices, attribution and flow totals. The parser rejects unexpected exchange identity, duplicate/future timestamps, nonfinite or negative quantities and nonconsecutive days. No provider payload is checked into this repository. React lifecycle tests cover initial no-fetch, explicit opt-in, denied access without retry, double-click suppression and unmount cancellation.

The production gate is not a public service authentication mechanism: production data display is disabled entirely. Do not enable or deploy this research view through a proxy to bypass a source denial or redistribution restriction.
