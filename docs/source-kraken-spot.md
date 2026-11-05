# Kraken spot evidence

## Scope and verified source

This layer reads one official, account-free public endpoint:
`https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD`.
It selects **BTC/USD and ETH/USD at Kraken**, not all crypto assets, all venues,
country flows, exchange deposits/withdrawals, or a global market aggregate.
There is no private API, account creation, credential, order or payment action.
A single development probe returned HTTP 200 with both requested keys on
2026-11-05 at 03:31:37 UTC. The response and actual observations are not in Git.
This establishes availability from that development environment at that time,
not live availability from an authenticated deployed Site or every jurisdiction.

Official references, reviewed 2026-11-05:

- [Ticker fields](https://docs.kraken.com/api-reference/market-data/get-ticker-information)
  (the official `.md` representation exposes the OpenAPI field descriptions).
- [Kraken ticker volume unit](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker):
  official ticker documentation explicitly identifies 24h volume in base-currency terms.
  This implementation uses the REST fields and does not import WebSocket timestamps.
- [Public endpoint examples](https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-):
  public market data does not require a Kraken account.
- [Public rate limits](https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-):
  rate limiting is IP-based for the ticker; one request per second or slower is
  the published general guidance. This application waits at least 60 seconds.
- [API use notice](https://docs-legacy.kraken.com/api/docs/guides/global-intro/):
  prior permission is required for certain uses, including non-personal
  commercial use of data from public endpoints. Public availability is not an
  unrestricted data license.

The existing owner-only hosted boundary remains unchanged. Only application code
and synthetic fixtures are published. Observations live in process memory, never
in Git, D1 or the public HTTP cache. A public/commercial deployment must separately
review and obtain applicable provider rights. This increment does not accept new
agreements, remove authentication, or claim a data redistribution license.

## Meaning and units

| Published field | Kraken field | Meaning |
| --- | --- | --- |
| `last_price_usd` | `c[0]` | Last traded price, USD per base coin |
| `volume_base_24h` | `v[1]` | Rolling-24h traded base-coin quantity, BTC or ETH |
| `vwap_usd_24h` | `p[1]` | Rolling-24h volume-weighted average price in USD |
| `trades_24h` | `t[1]` | Rolling-24h executed-trade count |
| `net_capital_flow` | absent | `null`: this endpoint provides no net capital flow |
| `open_interest` | absent | `null`: derivative open interest does not apply to these spot pairs |

The first volume/VWAP/trade-count element is **today**, starting at 00:00 UTC,
not the rolling window. It is deliberately unused. `o` is today's opening price;
no 24h price-return percentage is inferred from it. The two base-coin volumes
are not summed. No USD turnover or flow is fabricated by multiplying price and
volume. Price/volume decimal strings stay exact through ingestion and display.
The public API returns no per-ticker observation time: `source_observed_at` is
`null`, latency is unknown, and `fetched_at` only records acquisition completion.

## Acquisition, stale data and denial

- `/api/v1/crypto/kraken/status` inspects metadata but never fetches the provider.
- `/api/v1/crypto/kraken/snapshot` reads through a process-local cache, using only
  a fixed GET URL with credentials omitted and redirects rejected. No caller
  parameter can change the source, symbols or refresh limits.
- One simultaneous in-process refresh is coalesced. An independent
  `kraken_source_gate` D1 row serializes acquisitions across isolates and enforces
  a 60-second quiet interval. This row contains **only coordination metadata**.
  Eastmoney and Sina gate states are untouched.
- Parsing requires exactly both expected pairs, complete selected tuple fields,
  nonnegative bounded decimal strings, positive price/VWAP and safe integer
  trade counts. Duplicate JSON keys, excessive nesting, HTML and incomplete
  snapshots cannot be published. Zero volume/trade count remain valid zeroes.
- Transport is bounded to 32 KiB and a 12-second acquisition deadline, with
  bounded DB coordination waits and an independent two-second release wait.
  The host retains the request lifecycle before asynchronous inspection. Client
  cancellation aborts upstream work while its owner-token cleanup remains alive;
  late DB mutations remain retained after bounded response waits. Missing or
  failed lifetime registration prevents source admission. Native Workers decoding handles gzip/Brotli;
  the parser also caps decompressed bytes. Source bodies and cookies are not
  logged, forwarded, persisted or checked in.
- Successful snapshots are fresh **as acquisitions** for 60 seconds. A failed
  source check can retain a last-good snapshot with explicit stale status for
  at most 15 minutes; after that no rows are returned. The browser also ages
  snapshots independently, including hidden-tab/failed-network cases.
- Temporary errors use exponential in-process backoff and a shared minimum
  60-second pause. A longer `Retry-After` persists in D1 and is never shortened.
- 401/403/407/429/451, redirects, challenge HTML or API access/rate denials stop
  acquisition. Denial persists across workers, cached data is hidden, and there
  is no geographic workaround, host rotation, login, automatic reset or retry.
  An uncertain gate release fails closed. A crashed busy lease has no automatic
  expiry/takeover; review is required before changing it.
- Cold workers cannot access another worker's ephemeral snapshot. During the
  shared quiet interval they truthfully return unavailable, rather than refetch
  early or invent a distributed market cache. HTTP responses use `no-store`.

## Interface and deployment

`/crypto` is a separate single-venue asset page, linked from `/markets`; A-share
remains the first navigation link. No country is assigned this venue's turnover.
The page loads on entry and checks at 60-second intervals while visible, pauses
on denial, aborts superseded/unmounted requests, labels UTC fetch time and unknown
source time separately, and never includes production sample prices.

Before deployment, apply `apps/site/drizzle/0003_brainy_donald_blake.sql` through
the supported migration workflow. Missing storage fails closed without contacting
the source. Merely committing this increment does not deploy it or apply a remote
migration. Keep the existing authentication boundary.

Checks: `npm test`, `npx tsc --noEmit`, `npm run build`, and
`npm run test:kraken-runtime` from `apps/site`. The native workerd test exercises
the checked-in host, compression, D1 cooldown, Retry-After and persistent denial
across separate native workers sharing D1. An explicit request cancellation after
its outer response verifies retained cleanup, no publication and cold-worker
cooldown. All real network access is disabled. Unit/UI tests cover
semantics, malformed data, missing evidence, stale/expiry, concurrent requests,
network failure, unmount and denied-state polling. These offline checks do not
claim live deployed-source verification.
