# Sina industry money-flow candidate

## Status: implemented and tested, not connected live

This is a separate candidate adapter for the owner's personal research preview.
`apps/site/lib/sina/host.ts` deliberately keeps acquisition disabled. Its API
returns `source_use_review_pending` and performs no source or database requests.
No Sina data is shown in the current A-share UI. Eastmoney remains unchanged.

Ordinary unauthenticated requests worked during separate source research, but
that does not establish availability from the deployed Worker, a current data
license, a stable API contract, or permission for every off-Sina use. The user's
personal-only purpose reduces the intended audience; it is not a finding that
source-use rights have been established or that personal use is prohibited.
Review the intended usage against the provider's terms before enabling this
host. Do not deploy it as an unrestricted public financial-data endpoint.

- Source page: https://vip.stock.finance.sina.com.cn/moneyflow/
- Legacy methodology: https://finance.sina.com.cn/temp/guest4377.shtml
- Source copyright statement: https://corp.sina.com.cn/chn/copyright.html
- Page-owned client script used to identify the methods:
  https://n.sinaimg.cn/finance/cnstock/pc/zjlx.z.js?ver=1.1

## Contract and limits

Routes, independent from the Eastmoney API:

- `GET /api/v1/ashare/sina/snapshot`
- `GET /api/v1/ashare/sina/status` (never acquires)

Queries and other methods are rejected. There is no automatic failover,
no stock drilldown in this adapter, and no claim of whole-active-A-share coverage.
The schema is `sina-industry-evidence/1`; source, methodology, and terms are
included in every snapshot. Its metric is `sina_net_active_flow`, not Eastmoney
f62, not a reconstruction of beneficial-owner institutional flows, and not new
money entering the overall market. Sina's industry classification `fenlei=0`
is retained; exclusivity and exhaustive security coverage are not asserted.

`inamount`, `outamount`, and `netamount` are decimal **yuan** strings. They stay
exact decimal strings in the API, with fixed-scale integer arithmetic checking
inflow minus outflow equals net flow whenever all three are supplied. The
provider's ratio and return fields stay fractions, not percentage points.
Null remains null. Zero price is flagged as zero price, not evidence of an
inactive stock. Unverified turnover and leading-stock fields are not repurposed.

The ranking provides no trade date or provider timestamp: `trade_date` and
`source_observed_at` remain null. `acquisition_started_at` and `fetched_at`
identify the request interval only. Current delay is unknown. No HTTP Date,
sampled stock, or separate time-series date is borrowed as rank provenance.

## Completeness and transport

An enabled request performs exactly these bounded normal GETs, at least three
seconds apart, using only an Accept header:

1. `MoneyFlow.ssc_bkzj_bk?fenlei=0`
2. `MoneyFlow.ssl_bkzj_bk?page=1&num=100&sort=netamount&asc=0&fenlei=0`
3. The same count check again.

The count must be positive, no greater than 100, unchanged before and after,
and equal to the single response's unique valid industry IDs. The adapter
fails closed above 100 instead of paginating a changing flow ranking. This
avoids cross-page rank races; count agreement does not prove a transactional
market timestamp or unchanged underlying constituents. Validated output is
sorted by stable source ID, without aggregating possibly overlapping sectors.

The total decoded byte budget is 256 KiB and the acquisition deadline is 30s.
GBK/GB2312 and UTF-8 JSON are decoded explicitly. Workers native gzip/Brotli
handling is accepted without double decompression. Invalid decimal syntax,
duplicate JSON keys, unknown encodings, partial lists, duplicate IDs and invalid
arithmetic reject the complete candidate. Responses and logs never expose raw
upstream error bodies. No proxies, credentials, tokens, browser impersonation,
redirect following, CAPTCHA handling or access-control workarounds are used.

## Cache and independent denial protection

The new `sina_source_gate` table stores coordination metadata only. It does not
share or modify the Eastmoney `ashare_source_gate` row. D1 serializes acquisition
across isolates and enforces at least five minutes between completed requests.
Same-isolate requests are deduplicated; validated observations exist only in
memory. There are no background timers or automatic collectors.

HTTP 401/403/407/429/451, redirects, and challenge content permanently latch
this source as blocked. There is no automatic reset, lease takeover, or retry of
a denial. A crash leaves a busy lease for explicit review. Uncertain gate writes
stop publication and further local acquisition. A bounded wait prevents a hung
gate operation from holding the API forever.

Temporary failures back off for at least five minutes; a longer Retry-After is
also retained in D1. No immediate upstream retry occurs. A prior good snapshot
may be returned explicitly stale with an error; absent data is unavailable, not
zero-filled or replaced by another provider. Revoking enablement suppresses
cached data as well. All API replies are private/no-store.

## Verification and activation boundary

Reproducible local verification:

```sh
cd apps/site
npm test
npm run test:sina-runtime
npx tsc --noEmit
npm run build
```

Unit tests use synthetic rows only. The runtime test executes the actual adapter
and actual D1 gate in workerd, blocks real network connections, and tests GBK,
gzip, Brotli, cache reuse, cross-handler cooldown, persisted denial, and unchanged
Eastmoney state. These tests do **not** verify live deployed connectivity.

Before activation, establish intended source use, retain owner-only access,
apply migration `0002_faithful_pyro.sql`, review the explicit disabled host flag,
and validate one bounded industry acquisition from the deployed Worker. Stop
on denial or challenge. Do not clear a source latch merely to try again. A
future user-facing view must consume this separate schema and label its metric,
classification, timestamp limits, completeness, and stale/error states.

No captured observations, research payloads, or provider screenshots are stored
in the repository. All test numbers are synthetic and never served by production.
