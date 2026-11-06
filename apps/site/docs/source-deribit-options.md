# Personal-use Deribit BTC and ETH option matrix

## Scope and source verification

`/options` displays only the production Deribit BTC and ETH option chains. It does not
represent US equity options, other exchanges, other underlying currencies, all derivatives, or
net capital inflow. The existing CFTC futures positioning page is unchanged.

Four fixed official unauthenticated GETs are permitted, under one provider admission:

- `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option`
- `https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false`
- `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option`
- `https://www.deribit.com/api/v2/public/get_instruments?currency=ETH&kind=option&expired=false`

No user-supplied URL/currency/instrument, credentials, cookies, accounts, orders,
authentication endpoints or paid feeds are used. On 2026-11-06 a transient public
probe received 936 production BTC option rows (`testnet=false`), with summary
timestamps beginning 08:22:20.017 UTC. The metadata endpoint independently returned
936 instruments. A separate ETH probe on the same date returned 800 summary rows
and 800 matching instruments, with explicit ETH quote/base/settlement units and
USD counter currency. These were independent observations, not a combined live
BTC/ETH snapshot. Observations are not committed, bundled in the application or
used as fallback data. That cloud probe is not proof of authenticated hosted
availability.

## Units and matrix contract

The matrix area uses the source's `volume_usd` field, labelled “source 24-hour
traded amount (USD)”. It is an observed turnover field, not an OI valuation,
net cash investment, capital inflow, or a direction estimate. No additional
claim about the source's USD conversion or notional methodology is made.
We neither multiply open interest by the underlying price nor estimate USD
turnover from mark price. Every amount in one matrix uses the same source,
currency, bounded acquisition interval and rolling-statistic scope.
BTC/ETH source row clocks must fit within five seconds; this is not a claim
of perfectly simultaneous exchange observations. Zero amounts occupy no area
but remain in the complete selectable details. No minimum monetary tile sizes
or equal-area substitutes are used. Filters change the disclosed denominator.

Colors use the reported price change, separately from amount. Missing changes
and instruments with no reported volume remain unknown, never zero returns.
The UI provides each contract's explicit underlying currency: mark and quoted
prices are BTC per underlying BTC or ETH per underlying ETH; volume, source OI
and contract size use that row's underlying coin. OI is not an integer contract
count or a USD amount. The USD counter currency is validated from metadata. Contract size, strike, call/put and expiration come
from official instrument metadata, not inferred from expiry text in a symbol.
Groups are underlying/option-expiry navigation, not equity industry sectors.
The local underlying filter changes only the displayed scope; it never requests
a separate currency endpoint or creates a new admission budget.

See the official [summary fields](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)
and [option collection guidance](https://docs.deribit.com/articles/options-data-collection-best-practices).

## Observation time, update cadence and publication delay

The page checks once per minute while visible; repeated requests and cold workers
share the same persistent one-minute source gate. This is a periodically refreshed
snapshot, not a continuous real-time stream. Each row retains its source
`creation_timestamp`; the displayed source timestamp is the earliest row timestamp.
Rows must fit a five-second snapshot interval, and the source timestamp must be
close to acquisition. Fetch time is displayed separately. Clock freshness is not
proof of zero publication delay for all fields.

On 2026-11-06 the [5 November release announcement](https://support.deribit.com/hc/en-us/articles/40275495462301-5-November-2026)
states that its rollout was postponed until further notice. Its proposed changes
include eight-hour public OI delay and delayed Block RFQ contributions to volume.
The app therefore does not assert either that the proposed delay is already
effective or that all OI/turnover is real time. It stores
`delay_policy=source_delay_unconfirmed` and shows the publication-delay caveat.
Future added breakdown fields do not silently become new flow metrics.

Both source age and acquisition-cache age expire after five minutes. Expired
contracts disappear on the browser clock independently of further requests.
Network failures can preserve only unexpired validated evidence as stale. Access
denial clears evidence and stops requests. Hidden tabs stop polling but still
enforce expiry when rendered/resumed. No historical or mock snapshot is substituted.

## Acquisition, limits and shared state

Official [usage guidance](https://docs.deribit.com/articles/api-usage-policy)
permits public unauthenticated market reads but warns that unauthenticated
traffic faces stricter enforcement. [Published rate-limit examples](https://docs.deribit.com/articles/rate-limits)
are not a guaranteed anonymous quota. Our single gate admits at most one combined acquisition per
minute across all callers: exactly one BTC and one ETH summary. Each currency
reuses its metadata, with one additional GET only on cold start, active-set
change, or daily metadata revalidation. Two metadata requests in one acquisition
start at least 1.1 seconds apart, including cold starts.
There is no rapid instrument polling or repeated attempt to fill a missing chain.
An admission does at most four source GETs and has a 15-second total deadline.

The transport enforces 1.5 MB decoded bodies and 2,000 instruments per response,
4,000 rows and 3 MB in the combined cache, strict JSON,
no redirects and no alternate endpoint. Testnet, duplicate/incomplete/foreign
instruments, nonfinite or negative values and incoherent timestamps fail closed.
HTTP 401/403/407/429/451, redirects, HTML challenges, and known JSON-RPC access or
10028 rate-limit errors stop this source persistently. Temporary failures back
off and honor longer Retry-After. Denied/busy/uncertain leases are never reset or
taken over. Busy or unconfirmed admission also suppresses last-good display; it is not treated as an ordinary source outage. Owned admission and cleanup remain registered with Workers waitUntil,
including late D1 settlement after an HTTP response or cancellation.
Before attempting a success write, the handler validates complete BTC+ETH coverage
and the serialized cache limit using the same checks retained independently by
the D1 gate. A deterministic preflight failure releases only its owned lease as
a temporary failure, applies the shared cooldown and preserves the exact previous
payload and observation clocks. Still-valid evidence remains stale; an actual
uncertain D1 write remains suppressed and is never retried or cleaned up blindly.

`0022_deribit_options_gate.sql` originally added this provider gate and cache.
The BTC/ETH extension deliberately retains the same table and legacy
`btc_options` row ID, so blocked/busy/cooldown state cannot be bypassed by
switching currency or deployment. No migration or gate reset is needed.
The exact validated v72 BTC cache schema is read compatibly and remains labelled
BTC-only until the next permitted complete BTC+ETH acquisition. New cache writes
use schema 2. Both currencies must validate before anything is published; a
denial at either summary or metadata endpoint purges the entire provider cache.
Existing blocked providers are not modified.
Both GET routes share that gate; `/status` and the central diagnostics are
read-only and never collect data. Missing storage fails closed. The only retained
payload is the current normalized public snapshot; there is no raw-response archive.

## Personal-use rights and access boundary

The [13 August 2026 Deribit terms, section 2.10](https://support.deribit.com/hc/en-us/articles/25944532191645-Deribit-Exchange-Membership-Terms-Deribit-FZE)
limit market and derived data to personal use and require written approval for
non-personal processing/distribution. This integration is only for the existing
owner-only personal site. It does not make the repository, site or financial data
public and does not claim a redistribution license. Public or commercial use is
outside this delivery. No account is created, no membership checkbox is accepted,
and no financial transaction is performed. Source code and synthetic fixtures
contain no captured provider observations.

## Verification and deployment

Tests cover units, exact-chain validation, source clocks, null/zero behavior,
true monetary area, filters, lifecycle interruption, local/source denials,
cache expiry, shared metadata and bounded acquisition. `test:deribit-runtime`
runs the actual host in native workerd with D1 and disabled external network:
plain/gzip/Brotli responses, cold-cache reuse, shared cooldown, persistent
HTTP/JSON-RPC denial, Retry-After and cancellation cleanup are exercised while
all pre-existing provider tables remain unchanged. Full suite, lint, typecheck,
production build and independent review are separate checks, not implied by
the presence of this document.

The v72 gate migration must already be applied, or must be applied through the
supported hosting workflow on a fresh install. This extension adds no migration. A commit alone does not deploy or migrate production. Do not bypass
the existing owner authentication boundary to verify the deployment.
