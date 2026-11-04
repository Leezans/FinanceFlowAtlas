# FinanceFlowAtlas AKShare adapter

A conservative Python normalization layer for AKShare 1.20.27 A-share industry and constituent order-flow tables. No credentials, subscription, Tushare, automatic network fetch, production route, scheduler, or downloaded market observations are included.

## Status

Implemented and synthetic-tested: today's industry ranking and one industry's stock summary; negative amounts, zero/missing distinction, documented return-column aliases, safe values, six-digit security-code preservation, duplicate/overlapping membership checks, stable semantic versions.

This is **provider evidence**, not an operational market service and not an `ashare-tree/1` snapshot. `production_ready` is false and `display_rights` is `not_established`. These facts must not be changed simply to satisfy a frontend validator.

## Run

Python 3.11+; normalization itself has no third-party dependencies.

```sh
python -m venv .venv
.venv/bin/pip install -e .
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
# Optional official package, for an independently permitted acquisition workflow:
.venv/bin/pip install -e '.[provider]'
```

The provider package was installed and its relevant function source inspected in the development environment. Bounded read-only development probes verified the official `push2.eastmoney.com` → HTTPS `push2delay.eastmoney.com` redirect and subsequent data responses. A later limited acquisition returned 496 industry rows. One industry's stock summary returned 100 rows while raw upstream metadata declared 523: **the library summary is truncated**, not complete constituent coverage. The industry list also mixes classification levels, so its rows must not be summed as mutually exclusive industries. All downloaded observations remain outside source control, and no source was deployed or redistributed.

The guard recorded rank/summary requests, but the client's internal name/code mapping used a separate Session path. Its requests were not included in that guard's counter. Consequently the recorded count is not a complete transport audit. Any production transport must enforce timeout, allowed targets, redirects, request budgets and stop-on-denial rules across all transport paths before it is enabled. No claim of a production-safe collector is made.

Tests contain only synthetic observations. Actual source metadata is optional `source_total`; absent totals stay unknown, and returned counts below that total are explicitly partial. Completion of a source response does not establish full-market coverage or classification exclusivity.

## Intended source chain

- `akshare.stock_sector_fund_flow_rank(indicator='今日', sector_type='行业资金流')`
- `akshare.stock_sector_fund_flow_summary(symbol=<exact industry name>, indicator='今日')`
- Call `normalize(frame.to_dict('records'), kind='industry_rank' | 'industry_stocks', retrieved_at=<UTC retrieval end>, akshare_version='1.20.27', industry_name=<stock summary only>)` after authorized acquisition.

Only the documented current-day columns are accepted. Five/ten-day windows are deliberately unsupported. The summary uses `今天涨跌幅`; the rank uses `今日涨跌幅`. Both aliases are handled, but contradictory values fail validation. Amounts use documented CNY; ratios and returns retain percentage values, not decimal ratios. No scaling from market price or volume is performed. Provider main-order net is retained separately; never reconstructed from bucket sums.

## Why metadata is unknown

The installed client fetches source f124 timestamp and f13 exchange in the summary but removes them before returning its DataFrame. Ranking also lacks a source timestamp and stable sector code. Therefore `observed_at`, `trade_date`, `mic`, and canonical `instrument_id` remain null. Fetch time is not a quote time. Industry names are provider-local labels, not immutable taxonomy IDs. This layer cannot establish listing dates, industry mutual exclusivity, trading calendar, turnover, or market capitalization.

Before frontend integration, obtain a trustworthy reference/time layer or explicitly extend the display contract to show unknown metadata. Do not invent listing dates, infer exchange from an unverified numeric prefix, mark the current retrieval day as trading day, or label a snapshot live. A single returned industry summary cannot establish global industry exclusivity or full-market completeness. Check supplied memberships for overlap and keep provider sector figures separate from sums of retrieved stocks.

## Access and data rights

AKShare code is MIT, but its official overview says interfaces and data are intended for academic research. Upstream Eastmoney access/display rights are separate. Installing an open-source client does not establish permission for hosted commercial or private redistribution. This package does not grant or claim that permission. An operator must verify intended acquisition and display rights before connecting the source, respect access restrictions, use bounded requests/timeouts, and avoid retrying denials through alternate routes.

Primary sources:
- https://akshare.akfamily.xyz/introduction.html
- https://akshare.akfamily.xyz/data/stock/stock_flow.html
- https://github.com/akfamily/akshare/blob/main/akshare/stock/flow/stock_fund_em.py
- https://github.com/akfamily/akshare/blob/main/akshare/stock/board/stock_board_industry_em.py

This adapter's source is Apache-2.0 under the repository license; that does not license third-party datasets. It imports the optional AKShare package, rather than copying its implementation.
