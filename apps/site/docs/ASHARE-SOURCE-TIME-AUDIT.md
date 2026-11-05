# A-share source-time audit

Reviewed 2026-11-05. Scope: Eastmoney `clist/get`, level-one industry rows and
selected-industry stock rows. This audit made **no live market-data API request**,
did not alter the source gate, and did not retry any denied operation.

## Result

**Unresolved: a validated observation timestamp and trade date for `f62` are not
established.** Do not advertise the present feed as verified real-time. A
60-second app check, new fetch time, new ETag, successful HTTP request, market
session clock, or changed quote value does not establish when the flow was
observed or its source delay. This is an evidence gap, not a finding that
Eastmoney has no timestamp fields.

No first-party field definition was found that establishes that `f124` or `f297`
is the observation time/date of `f62` for these two scopes. Therefore no new
timestamp field has been enabled in the request and the flow contract remains:

- `source_observed_at: null`
- `trade_date: null`
- `delay_status: not_provided` (legacy schema value meaning no verified delay
  is provided by this application, not a claim that the provider has no field)

## Evidence and limits

1. [Eastmoney industry money-flow page](https://data.eastmoney.com/bkzj/hy.html)
   is the first-party industry-flow page. The available rendered text does not
   define `f124`, its units, or synchronization with `f62`.
2. [Eastmoney stock money-flow page](https://data.eastmoney.com/zjlx/600000.html)
   separates real-time flow and transaction-distribution displays from post-close
   flow displays. It has update-time placeholders, including a 16:05 post-close
   label. It does not identify the raw field behind those times. A page heading
   alone cannot bind `f124` to the `clist/get` flow observation.
3. [AKShare ETF adapter source](https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_etf_em.py)
   is primary evidence of **AKShare's implementation**, not an Eastmoney field
   contract. Its `fund_etf_spot_em` requests `f62`, `f124`, and `f297` together;
   it labels `f124` as update time and parses it as Unix seconds, first UTC and
   then `Asia/Shanghai`. It parses `f297` separately as `YYYYMMDD` data date.
   This corroborates a quote/update-clock interpretation and a separate date
   field in an ETF adapter. It does not establish semantics or availability for
   our industry/stock scopes, nor that `f62` updates atomically with that clock.

Search results for unofficial field lists and scrapers were not treated as a
provider guarantee. The first-party stock-page help link redirects to an article
without an available field definition. No source delay SLA, timestamp-to-flow
binding, or complete per-scope timing coverage was verified in this pass.

## Conditions for enabling timestamps

1. Establish the exact endpoint, scope, field meaning, unit, time zone, and
   timestamp-to-metric relationship from first-party documentation or explicit
   first-party code. Independently confirm actual optional-field behavior only
   through the authorized acquisition path and existing gate. A quote-only
   field must be named and displayed as a quote time, not a flow time.
2. Keep provider trade date separate from timestamp and fetch time. Validate
   `YYYYMMDD` calendar dates independently if `f297` becomes supported. Do not
   infer flow trade date from the fetch clock, exchange holiday schedule, or a
   quote clock whose relation to flow is unverified.
3. Validate any Unix-second field strictly. Missing placeholders, zero, wrong
   units, invalid dates, impossible or future values, and mixed/stale dates must
   have explicit unknown/conflict states, not default to now or zero delay.
   Epoch seconds denote an absolute instant; use `Asia/Shanghai` only for local
   display/date comparison, not an additional offset to the epoch.
4. Preserve row-level coverage. A maximum timestamp from one row cannot date all
   rows. Show missing counts and earliest/latest times if a range is needed;
   heterogeneous pages remain non-atomic. Never use one page's timestamp to
   bless an entire multi-page snapshot.
5. Separate measured age from a provider delay guarantee. `fetched_at` minus a
   verified quote time is quote age at collection, not automatically a delay for
   funds flow. A stale quote date can coexist with fresher flow, or vice versa.
6. Keep `f62` as the supplier's order-classification net-flow proxy in CNY. No
   price, turnover, timestamp, missing row, or unavailable value becomes new
   capital flow or an invented zero. Keep the existing gate, shared pacing,
   retry/denial behavior, stable-code pagination, and completeness checks.

## Delivered guardrails

UI wording now says flow timing is **not yet verified** rather than asserting
that the provider does not supply it. Synthetic regression tests prove that
plausible `f124`/`f297`, transport dates, and durable extra fields do not silently
populate flow timing, while missing and zero flow remain distinct. These tests
are offline validation, not evidence of live provider availability or freshness.
