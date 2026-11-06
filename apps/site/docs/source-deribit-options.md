# Personal-use Deribit BTC option matrix

## Scope and source verification

`/options` displays only the production Deribit BTC option chain. It does not
represent US equity options, other exchanges, ETH options, all derivatives, or
net capital inflow. The existing CFTC futures positioning page is unchanged.

Two fixed official unauthenticated GETs are permitted:

- `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option`
- `https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false`

No user-supplied URL/currency/instrument, credentials, cookies, accounts, orders,
authentication endpoints or paid feeds are used. On 2026-11-06 a transient public
probe received 936 production BTC option rows (`testnet=false`), with summary
timestamps beginning 08:22:20.017 UTC. The metadata endpoint independently returned
936 instruments. Observations are not committed, bundled in the application or
used as fallback data. That cloud probe is not proof of authenticated hosted
availability.

## Units and matrix contract

The matrix area uses the source's `volume_usd` field, labelled “source 24-hour
traded amount (USD)”. It is an observed turnover field, not an OI valuation,
net cash investment, capital inflow, or a direction estimate. No additional
claim about the source's USD conversion or notional methodology is made.
We neither multiply open interest by the underlying price nor estimate USD
turnover from mark price. Every amount in one matrix uses the same source,
currency, observation and rolling-statistic scope. Zero amounts occupy no area
but remain in the complete selectable details. No minimum monetary tile sizes
or equal-area substitutes are used. Filters change the disclosed denominator.

Colors use the reported price change, separately from amount. Missing changes
and instruments with no reported volume remain unknown, never zero returns.
The UI provides each contract's mark price, quoted BTC prices, implied
volatility, underlying BTC volume and source OI. OI is in underlying BTC, not
integer contracts or USD. Contract size, strike, call/put and expiration come
from official instrument metadata, not inferred from expiry text in a symbol.
Groups are option expiry/product navigation, not equity industry sectors.

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
are not a guaranteed anonymous quota. Our gate admits at most one summary per
minute across callers. Instrument metadata is reused, with one additional GET
only on cold start, an active-set change, or a daily metadata revalidation.
There is no rapid instrument polling or repeated attempt to fill a missing chain.
An admission does at most two source GETs and has a 15-second total deadline.

The transport enforces 1.5 MB decoded bodies, 2,000 instruments, strict JSON,
no redirects and no alternate endpoint. Testnet, duplicate/incomplete/foreign
instruments, nonfinite or negative values and incoherent timestamps fail closed.
HTTP 401/403/407/429/451, redirects, HTML challenges, and known JSON-RPC access or
10028 rate-limit errors stop this source persistently. Temporary failures back
off and honor longer Retry-After. Denied/busy/uncertain leases are never reset or
taken over. Busy or unconfirmed admission also suppresses last-good display; it is not treated as an ordinary source outage. Owned admission and cleanup remain registered with Workers waitUntil,
including late D1 settlement after an HTTP response or cancellation.

`0022_deribit_options_gate.sql` adds only an independent provider gate and its
validated public snapshot cache. Existing blocked providers are not modified.
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

Apply the appended migration through the supported hosting workflow before the
page is used. A commit alone does not deploy or migrate production. Do not bypass
the existing owner authentication boundary to verify the deployment.
