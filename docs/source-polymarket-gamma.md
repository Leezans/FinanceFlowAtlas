# Polymarket informational market matrix

## Current version and historical contract

The current collector exposes two separate modes: a one-page 100-record
volume-ranked hot sample and an ID-ordered keyset sample of up to five pages
of 100 records. Their caches, clocks, and coverage remain distinct while
sharing one durable source gate. Both expose partial coverage and unknown total size.
See the [current implementation and compatibility contract](../apps/site/README.md#bounded-keyset-coverage)
and [official keyset evidence](../apps/site/docs/polymarket-coverage-contract.md).
The fixed single-page request and first-tag grouping described below document
the initial v1 release and its retained legacy cache, not the current collector.
Rights, unknown price timestamps, unverified volume units, and source-stop
restrictions still apply. Valid old samples retain their original semantics
and expire normally; they are never relabeled as keyset data.

## Scope and permissions

The owner-private `/polymarket` page reads a single fixed, public Gamma market
listing. It creates no account, stores no credentials, links no wallet, and has
no order, position, funding, payout, or trading operations. It does not alter the
existing hosting access boundary. No captured provider data is committed.

Official sources reviewed 2026-11-05:

- [Discover Markets](https://docs.polymarket.com/market-data/discover-markets):
  discovery data is public and does not require authentication.
- [List Markets](https://docs.polymarket.com/api-reference/markets/list-markets):
  listing filters, outcome prices, volume24hr, tags and updatedAt fields.
- [Rate Limits](https://docs.polymarket.com/api-reference/rate-limits): Gamma
  `/markets` is currently documented at 300 requests per 10 seconds, with
  Cloudflare throttling. This app is much more conservative: one bounded request
  per shared admission, with at least 30 seconds between completed attempts.
- [Research guide](https://institute.polymarket.com/data): Gamma is distinct
  from CLOB and account/activity APIs and supports research into implied
  probabilities, markets and tags.
- [Terms](https://polymarket.com/tos), effective August 11, 2026: informational
  features are distinct from trading features and geographic trading limits.
  Professional capital-market entities and market-data distributors require a
  written data agreement. Public API availability is not a general commercial
  use or redistribution license. This implementation asserts no such license.
- [Geographic restrictions](https://docs.polymarket.com/api-reference/geoblock):
  order restrictions are not an invitation to bypass access controls. No trading
  endpoint is used; any source denial or challenge stops acquisition durably.

This code is for the existing private informational use. Do not make its data
public, use it for institutional trading, or redistribute it without separately
checking rights and obtaining the necessary agreement. The source terms also
apply to API access and prohibit scraping/data-extraction tools. This adapter
uses the documented public discovery API, not website scraping; owner-private
hosting is not a blanket exemption from those terms. There is no CAPTCHA solving or alternative-host fallback.

## Fixed request and coverage

`GET https://gamma-api.polymarket.com/markets?limit=200&offset=0&active=true&closed=false&archived=false&order=volume24hr&ascending=false&include_tag=true`

Exactly one request per acquisition. The response is capped at 4 MB and 200
records. No pagination, historical backfill, or per-market fanout occurs.
The UI explicitly describes a bounded active-market sample ordered by the
source's 24-hour volume. It never says this is the complete Polymarket universe
or a total across prediction markets. Inactive/closed/archived or invalid records
are excluded and counted. Duplicate accepted market IDs reject the acquisition.
The `active` flag does not imply that a market is presently accepting orders.

Category grouping uses the source `category` when present, otherwise its first
returned tag, otherwise unclassified. It does not infer membership from question
keywords or assert a complete, mutually exclusive taxonomy. All questions remain
readable in an equal-area matrix; category count is a sample count, not a flow
or probability aggregate.

## Metric and clock semantics

Outcome names stay aligned with their price strings. For a Yes/No market the
matrix selects the explicitly named Yes outcome regardless of array position.
For another outcome pair it shows the first source-named outcome and its label.
Price × 100 is displayed as price-implied probability, not objective probability,
a forecast recommendation, or an instruction to wager. No probabilities are
summed across independent questions or averaged within categories.

`volume24hr` is preserved as a finite, nonnegative source-reported number. Its
currency/unit is not verified by the minimal field contract reviewed here, so
the page marks the unit unverified and never silently labels it USD/USDC or sums
it as a monetary flow. Source-reported zero and missing values are distinct.
There is no net-capital-flow calculation, trading advice, or synthetic fill-in.

`updatedAt` becomes `source_record_updated_at`: a source record's metadata time,
not a quoted-price or execution timestamp. `source_observed_at` stays null.
`acquisition_started_at` and `fetched_at` describe this app's request only.
Returned timestamps more than 60 seconds in the future are rejected per record.
Missing timestamps remain unknown, never replaced with the retrieval clock.

Visible pages check at most once every 30 seconds after the preceding request
and respect longer server retry times. This is polling, not a live tick stream.
Source latency and price observation time remain unknown. A successful fresh
HTTP request is not proof of a newly observed price. Display becomes stale after
30 seconds and stops after five minutes from the original successful acquisition,
including while a tab is hidden. Failures cannot extend that display lifetime.

## Boundaries and lifecycle

- `lib/polymarket/model.ts`: strict server/cache/browser contract and display age.
- `adapter.ts`: pure normalization and explicit sample coverage.
- `transport.ts`: fixed GET, bounded decoding and denial classification.
- `source-gate.ts`: independent primary D1 admission and atomic cache publication.
- `handler.ts`: bounded request lifetime, cooldown, stale/error response state.
- `host.ts` and API routes: host bindings only.
- `components/polymarket/matrix.ts`: pure view projection, no source access.
- `useSnapshot.ts`: browser request, polling, cancellation and trust boundary.
- `Polymarket.tsx`: presentation using the shared MatrixHeatmap.

Append migration `0015_polymarket_market_cache.sql` after existing migrations.
`0014` is the preceding staged A-share migration; the journal and generated
`0015` snapshot preserve its schema. Do not rewrite old migrations or reset other gates.
A shared primary D1 row commits the validated snapshot and releases the exact
lease atomically. Every request checks shared state; busy, blocked, corrupt,
unknown or unavailable permission state suppresses both warm and persisted rows.
An inspect/acquire race is also fail-closed at the API response boundary.

HTTP401/403/407/429/451, redirects, HTML challenges, and unexpected content types
persist a blocked state and erase the shared payload. No automatic lease takeover,
reset, alternate endpoint or retry-after-denial exists. Temporary failures retain
only a validated age-valid snapshot and use exponential cooldown, at least
30 seconds and at least any valid upstream Retry-After. Error state is persisted
so cold workers do not present a failed check as a fresh success.

The entire request lifetime is registered before asynchronous inspection. Owned
D1 writes are retained through settlement even after a response timeout or request
cancellation. Late admission performs exact-owner cancellation cleanup without a
source fetch. Uncertain publication is never retried; a later cold reader can only
use a fully validated, successfully committed snapshot.

## Validation and live-verification limit

Unit/UI tests use clearly synthetic questions. Tests cover outcome alignment,
zero versus missing metrics, source timestamps, sample bounds, duplicate records,
byte caps, cache expiry, strict parsing, all denial classes, corruption, concurrent
admission, stale owners, shared cooldown/error, uncertain late writes, interrupted
requests, hidden tabs, control preservation and warm-cache admission races.

`npm run test:polymarket-runtime` uses the checked-in host in native workerd and
D1, with real networking disabled. Plain, gzip and Brotli responses, cold caches,
transient errors, expiry, denial persistence and cancellation after an early HTTP
response are tested. These checks do not prove provider availability from the
production host. Live release verification must use the normal gated API route,
not an ungated probe, and must stop if the source denies access.
