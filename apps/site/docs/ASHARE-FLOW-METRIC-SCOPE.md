# A-share main-flow metric scope

Reviewed 2026-11-06 using public documentation and source code only. No live
Eastmoney data endpoint, production application/API, authentication path,
source gate or retained financial observation was accessed for this review.

## Evidence

[Eastmoney's own fund-flow help](https://emdesk.eastmoney.com/pc_activity/Pages/VIPTrade/pages/link/zjl.html)
explains, in questions 33 and 36, that its flow figures are calculated by the
software using transaction/order information and that main net flow combines
the net flow of the super-large and large order categories. It is not a measure
of every order category, an independently verified investor identity, or all
cash entering and leaving a stock or the market.

[AKShare's ETF adapter](https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_etf_em.py)
provides corroborating implementation evidence for the clist field names:
f62 is main net flow, f66 is super-large net flow, f72 is large net flow,
f78 is medium net flow, and f84 is small net flow. That source is an adapter
implementation, not an Eastmoney field specification or proof of current live
coverage. The existing A-share contract uses f62, CNY and the explicit
`provider_order_flow_proxy` metric kind. The review did not change that contract.

The supplier help describes its Level-2 product. It does not establish exact
current size thresholds, active/passive classification rules for every endpoint,
verified identities of institutions, observation timestamps, latency, or atomic
industry aggregation. This application does not invent those details or
recompute f62 from auxiliary fields. Quotes, prices and returns remain separate.

## Display gap and correction

The previous labels described an order-classification estimate and warned
against treating it as new market capital, but did not plainly identify the
excluded order categories or distinguish it from all transaction money flow.
The market directory also labeled an AKShare link as provider documentation,
although AKShare is not the provider.

An always-visible note now identifies Eastmoney, f62 and CNY, explains the
large/super-large scope and exclusion of medium/small categories, and states
that it is not all stock/market transaction money flow or new incoming capital.
The note links to Eastmoney's own explanation. It remains visible for industry,
constituent, stale, empty and blocked states. Matrix previews, the landing and
market directory carry the same limited-scope wording; the directory source
attribution now points to the actual supplier explanation.

Only presentation and explanatory text changed. Signs, raw amounts, area
calculation, missing values, pagination, request cadence, access controls,
denial gates and unknown source-time metadata are unchanged. The displayed
formula is an explanation, not a new calculation or consistency assumption.

## Verification

The new synthetic tests fail on the old UI and cover visible scope, the primary
source link, empty/blocked/error states, stale warnings, and raw f62 preservation
when other synthetic fields differ. No test renders fake data in production.
The broader existing test suite continues to exercise monetary area, sorting,
missing data and source lifecycle behavior. Test/build results and publication
status are recorded separately in the release report.
