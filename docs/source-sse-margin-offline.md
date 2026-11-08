# SSE daily margin financing: offline research adapter

This opt-in Python adapter reads already-acquired local official SSE XLS files.
It has no downloader, scheduled task, API route, hosted panel or industry join.
It calculates **financing buy amount minus financing repayment amount (CNY)**
for each reported security and the detail universe. This is daily margin-account
financing activity, **not market net capital flow**, not an institutional-trading
measure and not real-time data. No summary repayment amount is supplied, so a
summary financing-net figure is deliberately not manufactured.

## Use

Install optional dependencies with `pip install -e '.[sse-margin,test]'`.
Run from the repository with `PYTHONPATH=packages/core/src`:

```sh
python -m financeflow.source_sse_margin /private/path/daily.xls \
  --observation-date 2026-11-06 --retrieved-at 2026-11-08T14:00:21Z
python -m unittest discover -s tests -p test_sse_margin.py -v
```

JSON goes to standard output. Keep raw files and generated observations outside
Git and public hosting; public accessibility is not redistribution permission.
The adapter does not fetch the recorded source URL. The observation date is an
explicit operator assertion derived from the verified download URL: the workbook
itself contains no date. Retrieval time is caller supplied and normalized to UTC;
publication time remains unknown. Bytes, SHA-256 and expected official source URL
are recorded for audit. Do not substitute retrieval time for the trading date.

## Schema and safety boundaries

Only the verified two-sheet layout (`汇总信息`, `明细信息`), exact Chinese headers,
text security codes and nonnegative integer text amounts are accepted. Leading
zeros are preserved. Missing, malformed, fractional or negative inputs fail
rather than becoming zeros. Duplicate codes, changed columns and unknown summary
footers fail. Input is limited to 4 MiB; decoded summary/detail are limited to
100 / 10,001 rows and 6 / 8 columns respectively. xlrd decodes the local legacy
BIFF XLS; no macros or external links are executed. The byte budget is applied
before decoding, sheet dimensions afterward, so this is not a hardened sandbox
for arbitrary hostile spreadsheets. Use only trusted acquired source files.

All detail securities are retained, including ETFs and other instruments. Every
instrument type is explicitly `unverified`, industry is null, and neither names
nor code prefixes are treated as authoritative classifications. There is no
stock-only total and no sector aggregate. Short-sale quantities retain source
units and must not be combined with financing CNY amounts.

Summary and detail totals remain separate. Their differences, including balance
and short-quantity differences, are reported without zero-filling or assuming the
universes match. The optional two-snapshot comparison reports each common code's
balance-change-minus-buy-plus-repayment residual and added/removed codes. It does
not assert consecutive sessions, require exact equality, choose a rounding
tolerance, or infer missing repayments from balances.

## Local source verification (2026-11-08 UTC)

Verified official files, kept outside the repository:

- https://www.sse.com.cn/market/dealingdata/overview/margin/a/rzrqjygk20261105.xls
- https://www.sse.com.cn/market/dealingdata/overview/margin/a/rzrqjygk20261106.xls

Both decoded successfully with 2,017 unique detail securities and no missing
numeric cells. Detail buys reconcile to summary buys, while financing balances
and short balances do not. On the common securities, 870 financing rollforwards
have a nonzero residual (range -4 to +3 CNY). The cause is unverified; rounding
must not be silently assumed. Industry mapping remains unverified. These checks
are a two-date research sample, not proof of a stable production feed.

Tests use invented values and generate temporary synthetic XLS files. No provider
workbook or per-security observations are distributed in this change. xlwt is a
test-only writer; xlrd is the optional runtime reader. There is no site build or
runtime dependency change.
