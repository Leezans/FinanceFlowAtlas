# Optional Polymarket open-interest amount view

Reviewed against official documentation on 2026-11-06. This is an additional
owner-private informational view, not a replacement for Gamma probability or
unverified-unit volume, and not a trading feature. Only code and synthetic test
fixtures are committed. No captured provider data, wallet information, account
credentials or trading operations are included.

## Evidence and metric

- [Analytics](https://docs.polymarket.com/market-data/public-analytics#open-interest)
  explicitly denominates open interest in USDC. The official
  [Python SDK](https://github.com/Polymarket/py-sdk/blob/ddee30cebb6322d41119e10b20ea6a875a7f1c9c/src/polymarket/clients/public.py)
  independently documents the same unit.
- [OI endpoint](https://docs.polymarket.com/api-reference/markets/get-open-interest)
  defines priced gross open interest. This is the value of outstanding positions,
  not traded volume, net deposits, net capital flow or a sum of user cash flows.
  Its GET batch accepts at most 20 distinct condition IDs and is not paginated.
  A missing row means that condition was not resolved to a servable market;
  an explicit zero is a zero. The endpoint's unfiltered GLOBAL value is never requested.
- [Data API v2](https://docs.polymarket.com/api-reference/data-api/overview)
  is publicly readable without authentication. Bare volume/size fields describe
  shares; those conventions must not be transplanted to the separate Gamma API.
- [Market details](https://docs.polymarket.com/market-data/market-details#liquidity-and-activity)
  establishes Gamma volume24hr's trailing-24-hour scope but does not establish its
  currency. It remains source-unit volume and never receives monetary area metadata.
- [Rate limits](https://docs.polymarket.com/api-reference/rate-limits#v2)
  documents an 800 requests/10-second/IP v2 aggregate limit, not an instruction to
  approach it. This app requests one OI batch at least five minutes apart.

## Selection and amounts

The separate `interest` mode obtains one fixed, bounded Gamma hot window, then
selects its first 20 distinct supported condition IDs. Only source-provided
0x + 64 hex IDs are accepted, normalized to lowercase. Other families remain
unsupported, never guessed from numeric market IDs. Missing/unsupported IDs,
duplicate conditions, invalid Gamma rows and rows beyond the cap are counted
separately. This is not an OI ranking or whole-market coverage.

One OI GET requests precisely those conditions. Results are joined by condition
ID, never response order. Unknown, duplicate, malformed and GLOBAL results reject
the acquisition. Valid omitted conditions remain null; zero is retained. Only OI
values declare `amount.currency = USDC`. Treemap area is proportional to positive
amounts; zero and missing entries remain in readable details and coverage counts.
No USD conversion, cross-market flow inference or synthetic fill-in occurs.

## Independent clocks, shared denial boundary

The sources share one existing durable lease, terminal denial state and 12-second
request lifetime. Gamma is capped at 4 MB and OI at 64 KB, with one shared 8 MB
acquisition budget. There is no per-market fanout, pagination or fallback. A
failed second request does not publish the new Gamma sample with an old OI amount.

Migration `0021_polymarket_interest_cooldown` only appends four columns to the
existing gate. It preserves every prior payload, cooldown, denial and lease.
OI admission atomically checks both the ordinary shared cooldown and its own
persisted deadline. Success, temporary failure, no eligible conditions and
cancellation retain the OI five-minute minimum across cold workers. Ordinary hot
and newest modes remain at 30 seconds; their success cannot clear the OI clock
or OI error. Source Retry-After is still honored globally when supplied, and
401/403/407/429/451, redirects and challenges block all three modes. No state is
reset to enable a new endpoint.

OI's source valuation timestamp is unknown. Gamma completion, OI request start
and OI completion are recorded separately and never presented as valuation time.
OI is stale after five minutes and hidden after ten; ordinary views retain their
30-second/five-minute rules. OI's longer lifetime does not expose old probability
values. Hidden pages stop polling. Browser retry deadlines are view-specific,
with an additional shared source deadline; mode changes cannot bypass either.

## Rights and verification limits

[Terms effective August 11, 2026](https://polymarket.com/tos) restrict automated
collection, professional capital-market use and market-data redistribution.
Documented public API access is not a blanket commercial data license. This
change retains the existing private informational access boundary and asserts
no permission for public data distribution. Open-source code licensing does not
license provider data. Reassess rights before changing that use or audience.

Tests use synthetic markets and disabled real networking, including native
workerd/D1 checks and production-build UI fixtures. Production authentication
restrictions are not bypassed: local test success and deployment acceptance are
not evidence of a fresh production OI response.
