# Kraken spot evidence

## Scope and verified source

This layer reads two fixed, official, account-free public endpoints:
- `https://api.kraken.com/0/public/AssetPairs?aclass_base=currency`
- `https://api.kraken.com/0/public/Ticker?asset_class=forex`

The catalog selects every returned **online USD-quoted spot currency pair**
within explicit budgets, and matches ticker keys against those official pair
identities. This includes crypto assets, stablecoins and any fiat pairs in that
source category. It excludes non-USD quotes, offline pairs and tokenized-asset
classes. It is not all crypto assets, all venues, industry coverage, country
flows, exchange deposits/withdrawals, or a global market aggregate. No sector,
country or market-cap classification is inferred. Kraken calls the ticker API
asset class `forex`; that endpoint category does not mean every selected asset
is conventional foreign exchange.

The original two-pair development probe returned HTTP 200 on 2026-11-05 at
03:31:37 UTC. That historical result is not verification of this broader universe
or its current production availability. The expansion has offline unit, UI and
native workerd validation; live deployment validation must use the existing
shared gate, without bypass, reset or alternative endpoint after denial.
There is no private API, account creation, credential, order or payment action.

Official references, reviewed 2026-11-05:

- [Tradable pairs and asset classes](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs)
  supply official pair keys, display names, quote currency and online status.
- [Ticker fields](https://docs.kraken.com/api-reference/market-data/get-ticker-information)
  (the official `.md` representation exposes the OpenAPI field descriptions).
- [Kraken ticker volume unit](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker):
  official ticker documentation explicitly identifies 24h volume in base-currency terms.
  This implementation uses the REST fields and does not import WebSocket timestamps.
- [Public endpoint examples](https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-):
  public market data does not require a Kraken account.
- [Public rate limits](https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-):
  rate limiting is IP-based for the ticker; one request per second or slower is
  the published general guidance. This application waits at least 60 seconds between acquisitions and at least
  1.1 seconds between metadata and ticker requests within one lease.
- [API use notice](https://docs-legacy.kraken.com/api/docs/guides/global-intro/):
  prior permission is required for certain uses, including non-personal
  commercial use of data from public endpoints. Public availability is not an
  unrestricted data license.

The existing owner-only hosted boundary remains unchanged. Only application code
and synthetic fixtures are published. Validated observations live in the owner-only primary D1 cache for bounded
reuse across workers, never in Git or the public HTTP cache. A public/commercial deployment must separately
review and obtain applicable provider rights. This increment does not accept new
agreements, remove authentication, or claim a data redistribution license.

## Meaning and units

| Published field | Kraken field | Meaning |
| --- | --- | --- |
| `last_price_usd` | `c[0]` | Last traded price, USD per base coin |
| `volume_base_24h` | `v[1]` | Rolling-24h traded base-coin quantity, in the returned base denomination |
| `vwap_usd_24h` | `p[1]` | Rolling-24h volume-weighted average price in USD |
| `trades_24h` | `t[1]` | Rolling-24h executed-trade count |
| `net_capital_flow` | absent | `null`: this endpoint provides no net capital flow |
| `open_interest` | absent | `null`: derivative open interest does not apply to these spot pairs |

The first volume/VWAP/trade-count element is **today**, starting at 00:00 UTC,
not the rolling window. It is deliberately unused. `o` is today's opening price;
no 24h price-return percentage is inferred from it. Different base-coin volumes
are not summed. No USD turnover or flow is fabricated by multiplying price and
volume. Price/volume decimal strings stay exact through ingestion and display.
The public API returns no per-ticker observation time: `source_observed_at` is
`null`, latency is unknown, and `fetched_at` only records acquisition completion.

## Acquisition, stale data and denial

- `/api/v1/crypto/kraken/status` inspects metadata but never fetches the provider.
- `/api/v1/crypto/kraken/snapshot` reads through the shared primary-D1 cache. Catalog
  identities refresh every 15 minutes; tickers refresh after a 60-second quiet
  interval. Both use the same pre-existing `kraken_source_gate` D1 row, owner
  token and retained cleanup. Metadata success alone is not published or cached
  until the full quote/trade bundle validates and its atomic cache publication
  and owner-token gate release succeed.
- Each top-level response has at most 10,000 pairs; the eligible USD universe has
  at most 2,000. Breaching a bound rejects the acquisition rather than silently
  truncating to a top-N sample. Exact decimal strings remain unchanged.
- Snapshot schema `kraken-spot/2` carries eligible and catalog counts, catalog
  fetch time, valid rows, per-pair missing/invalid reasons and complete/partial
  quality **relative to that catalog**. New listings may wait for catalog refresh.
  A missing or invalid ticker is omitted explicitly; valid peers remain visible.
  No valid rows means no candidate snapshot. Top-level denials still stop the
  whole source. Zero volume/trade count remains valid; zero prices/VWAP are not
  represented as usable prices. Every row keeps flow and open interest null.
- Transport is bounded to 8 MiB per response and a 12-second whole-acquisition
  deadline, including the 1.1-second spacing, with bounded DB coordination waits
  and an independent two-second release wait. Native Workers decoding handles
  gzip/Brotli and the parser also caps decompressed bytes. Source bodies and
  cookies are not logged, forwarded, persisted or checked in.
- The host retains the request lifecycle before asynchronous inspection. Client
  cancellation aborts upstream work while owner-token cleanup remains alive;
  late DB mutations remain retained after bounded response waits. Missing or
  failed lifetime registration prevents source admission.
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
- Cold workers reuse the same validated selection/window cohort during a
  successful quiet interval. Missing cohorts may use latest quotes without
  mismatched trades. Busy, denied, corrupt or unreadable permission/cache state
  returns no evidence. HTTP responses use `no-store`.

## Interface and deployment

`/crypto` is a separate single-venue asset page, linked from `/markets`; A-share
remains the first navigation link. No country is assigned this venue's turnover.
The page loads on entry and schedules its next check 60 seconds after the preceding fetch completes while
visible (avoiding fixed-interval/cooldown races), pauses
on denial, aborts superseded/unmounted requests, labels UTC fetch time and unknown
source time separately, and never includes production sample prices. A readable,
scrollable equal-area matrix and local pair search expose all validated pairs,
with explicit coverage/omissions instead of unreadably tiny top-N tiles.

Before deployment, apply existing migrations and append
`apps/site/drizzle/0017_kraken_shared_snapshots.sql` through the supported workflow.
It creates cache tables only and does not reset any existing source gate. Missing storage fails closed without contacting
the source. Merely committing this increment does not deploy it or apply a remote
migration. Keep the existing authentication boundary.

Checks: `npm test`, `npx tsc --noEmit`, `npm run build`, and
`npm run test:kraken-runtime` from `apps/site`. The native workerd test exercises
the checked-in host, compression, D1 cooldown, Retry-After and persistent denial
across separate native workers sharing D1. An explicit request cancellation after
its outer response verifies retained cleanup, no publication and cold-worker
cooldown. All real network access is disabled. Unit/UI tests cover
semantics, 700-pair synthetic coverage, metadata TTL/discovery, pacing, partial
coverage, client count validation, malformed data, missing evidence, stale/expiry, concurrent requests,
network failure, unmount and denied-state polling. These offline checks do not
claim live deployed-source verification.

## Shared snapshot boundary

`contract.ts` keeps transport-independent types/limits out of the acquisition
module. `validation.ts` is the shared response schema, `snapshot.ts` validates persisted
quote/catalog/trade identity and decimal/time contracts, and `snapshot-store.ts`
owns primary-D1 transactions. `shared-reply.ts` formats permission-checked reads;
the acquisition handler continues to own provider requests, pacing and lifetime.

An immutable bundle has one canonical selection/timeframe reference and may also
be the latest-quote fallback. References deduplicate that bundle; replacement
does not append history. At most 16 selected references plus latest retain at
most 17 bundles of 2 MB each. The original fetched time controls the 15-minute
expiry, never commit/read time. Successful publication lazily removes expired
references and orphaned bundles in the same owner-token transaction as release.
A stale owner cannot publish, prune, or release. Known pre-publication
validation failures release their exact owner as temporary failures. A submitted
batch with uncertain outcome stays retained and fail-closed, never retried. There is no raw API body, cookie,
account identifier, credential, or lease token in the persisted evidence.

Each read joins the durable permission row and the chosen evidence in one DB
statement. A selected cohort keeps its own original quotes and trade window,
even if another selection was acquired later. A missing/expired selected cohort
can use the latest valid quote bundle without attaching mismatched trades.
Cold status reads do not invent a last attempt time. No check claims quote
observation time or source latency is known.
