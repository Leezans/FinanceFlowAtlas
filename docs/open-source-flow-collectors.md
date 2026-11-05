# Open-source market-flow collector review

Checked 2026-11-05 UTC. The goal is a free, no-account source of current stock and
industry order-flow observations, with A shares first. Repository code was read;
no new market-data endpoint was called for this review. In particular, an
unconfirmed Eastmoney acquisition was not bypassed, retried or reset.

## Practical result

Open-source collectors do exist, including minute-level flow functions. The
strongest reusable references are **efinance**, **AData** and **AKShare**, but their
relevant A-share functions converge on the same Eastmoney endpoints. Switching
Python packages is not a new upstream or a fix for HTTP 502. Their source code is
useful for field mappings and collection design, not proof of a working feed in
this deployment.

No additional independent feed was verified here as simultaneously anonymous,
permitted for this display, currently reachable, complete and near-real-time.
That is a bounded research result, not a claim that none exists.

## Repository and source findings

| Project | Actual data path and metric | Use in FinanceFlowAtlas |
| --- | --- | --- |
| [efinance](https://github.com/Micro-sheep/efinance/blob/c8fd370a3109b2d14a121e3a32a86e9c8354b01b/efinance/common/getter.py) (MIT) | `get_today_bill` uses Eastmoney `fflow/kline/get` with `klt=1`: source time and cumulative main/small/medium/large/extra-large order-classified net amounts. `get_history_bill` uses daily `fflow/daykline/get`. | Directly relevant minute-flow reference. Not an independent fallback. Its clist code sorts acquisition by `f12` before sorting output; this informed the separate stable-paging fix. Do not copy its bulk concurrency or unrelated disabled TLS verification. |
| [AData](https://github.com/1nchaos/adata/blob/8217a4ec593e7bf6c9cf32a1aa74b711e7baa720/adata/stock/market/capital_flow/stock_capital_flow.py) (Apache-2.0) | Public `get_capital_flow_min` and `get_capital_flow` both delegate to Eastmoney. A retained Baidu implementation is not the default route. | Relevant minute and daily flow contracts, not a separate production feed. Tests assert a nonempty frame or row count, which does not prove observation freshness or complete industry coverage. |
| [AKShare](https://github.com/akfamily/akshare/blob/b611f9452ee379c3a2ca32e3480c9ff5bc7af3be/akshare/stock/flow/stock_fund_em.py) (MIT) | Individual and sector flow rankings call Eastmoney clist; historical flow uses Eastmoney daily flow. Separate [THS functions](https://github.com/akfamily/akshare/blob/b611f9452ee379c3a2ca32e3480c9ff5bc7af3be/akshare/stock/flow/stock_fund_flow.py) read THS webpages. | Useful field mapping and paging reference. Changing to AKShare does not remove the existing Eastmoney failure or the prior THS access denial. |
| [a-stock-data](https://github.com/simonlin1212/a-stock-data/blob/f21534946c42be3ad048ac938eecb1bad84cb8ab/SKILL.md) (Apache-2.0) | Current code uses Eastmoney for minute stock flow and sector flow, and Sina for daily fallback. It records replacing old Baidu flow routes with Eastmoney. | A broad source catalogue, not 34 independent flow providers. Do not adopt proxy changes, blocked-source alternate routes, or price/volume substitutions. Its general claims about dead Tencent routes conflict with previously observed date-bearing QQ responses, illustrating why README claims require verification. |
| [market-liquidity-radar](https://github.com/ulxs1213/market-liquidity-radar/blob/978496156342cc0719b56b9ff00c7d52928387b9/README.md) (MIT) | Eastmoney clist plus minute flow; optional TDX price/volume history. Its history distinguishes provider minute flow from locally recorded clist observations and signed-turnover proxies. | Useful gap/replay and source-label design. Its 3-second polling is an application setting, not demonstrated source latency. Do not copy automatic alternate-host fallback after a denial or treat local observations as complete historical flow. |
| [a-share-sector-flow-visualizer](https://github.com/dean-stack/a-share-sector-flow-visualizer/blob/c15e6bc4d4b66e1ce3f7785f522b7d4f3d9a5219/server.mjs) (no repository license detected) | Eastmoney/Sina/THS with local TDX support. Normalization replaces some missing amounts with zero, and the ranking request asks for 2,000 rows without proving that the server honored that page size. | Conceptual reference only; do not copy unlicensed code, missing-to-zero behavior or assume one response is complete. |
| [pysnowball](https://github.com/Pa55w0rd/pysnowball/blob/main/README.md) (this fork: Apache-2.0) | Snowball capital-flow methods have minute data in examples but require a manually supplied token. Financial `cash_flow` is a different, statement-period method. | Does not satisfy the present no-token requirement. No authentication or data request was attempted. |
| [sector-flow](https://github.com/czcode0501/sector-flow/blob/79ebdc718c91d374fbd00fbdfee12c68efe367a3/data.py) (MIT) | US sector ETF dashboard with Finnhub key-based quotes and Yahoo OHLCV. `compute_net_dollar_flow` is a candle-location multiplier times typical price and volume. | An indicator, not observed buy/sell capital flow or ETF creations/redemptions. Cannot populate the requested measured-flow cells. |
| [MONEY-IS-WATER](https://github.com/openclawby/MONEY-IS-WATER/blob/main/README.md) (MIT) | Requires a Clawby API key. Equities use dollar activity times percentage change; FX/metals use percentage change. Crypto has a different taker-flow field. | Attractive visualization, but not no-account global measured equity flow. The 20-second UI refresh and backend TTLs are not upstream latency evidence. |

The previously reviewed [pytdx](https://github.com/rainx/pytdx/blob/master/docs/pytdx_hq.md)
provides quotes and transaction prints, not a documented provider main-order-flow
field. [yfinance](https://github.com/ranaroussi/yfinance/blob/main/yfinance/pricing.proto)
does support live/minute quote data, but its streaming schema is price/volume,
not net capital flow. Neither is merely a year-end-data tool, and neither should
be mislabeled as a measured equity-flow source.

## Access and source-time limits

Code licenses do not grant market-data access or redistribution permission.
Existing provider restrictions still apply to a new wrapper or scraper. Relevant
official sources include the [Sina Finance agreement](https://finance.sina.com.cn/roll/2021-05-12/doc-ikmxzfmm2033220.shtml),
[Tencent agreement](https://edu.tencent.com/agreement.html),
[TDX agreement](https://www.tdx.com.cn/about/yhxy/index.html?tabindex=0), and
[Yahoo exchange/data notice](https://help.yahoo.com/kb/finance/SLN2310.html).
This review does not change any access gate or imply permission from HTTP 200.

A minute observation interval, 60-second app refresh, cache TTL and actual
source latency are different quantities. No new live latency was measured here.
The existing clist contract leaves source observation time, trade date and delay
unknown; fetch time does not fill those fields. The minute-flow route's dated
records could support a separate future contract after authorized live validation,
but do not establish coverage of all industries, stocks, ETFs or global markets.

## Reusable correction implemented separately

The existing collector now requests code ordering (`fid=f12`) rather than changing
flow rank (`fid=f62`) when walking clist pages. That prevents rank changes alone
from moving records across page boundaries. It does not prevent membership
changes, make pages atomic, prove source freshness or solve an upstream 502.

Synthetic regressions demonstrate the old rank-drift duplicate/omission, verify
complete code-ordered industry and stock pages, preserve duplicate/total/truncation
rejection, and verify the UI still sorts exact signed flow values independently.
No external code was copied or executed, and no raw provider observations were
added to Git. Existing access denial, timeout, byte, row, page, pacing and cache
controls remain unchanged.
