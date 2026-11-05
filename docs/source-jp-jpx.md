# Japan JPX investor trading: verified candidate, not enabled

Checked 2026-11-05 UTC against the official website and one current workbook.
This assessment does not assert permission to run an automated dashboard feed.

## Result and current format

The [official weekly page](https://www.jpx.co.jp/english/markets/statistics-equities/investor-type/)
and its linked [October 19–23, 2026 workbook](https://www.jpx.co.jp/english/markets/statistics-equities/investor-type/vk0khi000002thzf-att/stock_1_w_20261019_20261023.xlsx)
were each read once without credentials. Both returned HTTP 200. The workbook
was 12,924 bytes, an actual XLSX ZIP/XML file, not an HTML challenge. Its SHA-256
was `c0e00b99e4ebe132251f19c4aef3803ca4ec793b70c5d1dfdeb1179fbb25821b`.
Raw workbook bytes and numerical observations are not committed or deployed.

The workbook has one sheet with four market rows, each represented by separate
share-volume and trading-value lines. Its 14 nonoverlapping lowest-level
investor/account categories each have sales, purchases, balance and total
columns. All 112 tested category/market/measure groups reconcile exactly:
balance is purchases minus sales; total is purchases plus sales. Positive
balance is net buying by that category, not money created by the whole market.
Value units are **1,000 JPY**; volume units are **1,000 shares**. Never use a
volume row as a monetary observation.

The [official survey outline](https://www.jpx.co.jp/english/markets/statistics-equities/investor-type/07.html)
confirms a format break: through September 2026 week 2, volume and value were
separate files containing two weeks. From week 3 they are in one file containing
only the latest week. The [Japanese weekly notice](https://www.jpx.co.jp/markets/statistics-equities/investor-type/index.html)
also explains the change from one sheet per market to a single consolidated
sheet. Historical parsers must branch on validated schema, not assume the old
layout continues.

## Coverage and timing

- The four current sections are TSE Prime, Standard, Growth, and the combined
  Tokyo/Nagoya markets. The combined section overlaps the three TSE sections;
  adding all four would double count.
- Reporting covers general trading participants with at least JPY 3 billion
  capital. It concerns Japanese-company equities on Tokyo/Nagoya markets, not
  every Japanese asset, venue or investor. ETFs, REITs, TOKYO PRO Market and
  several special security types are excluded from this equities report.
- Survey transaction types include ordinary auction trades, specified ToSTNeT
  and N-NET trades, corrections and off-floor sells. Keep this scope distinct
  from exchange-wide turnover and balance-of-payments flows.
- The foreign category principally uses nonresidence rather than nationality,
  with the official stated branch-office exception. Proprietary trading is
  separate from securities-company customer orders.
- Weekly publication is approximately 15:30 JST on the fourth business day;
  holidays can change the date. Monthly and annual reports are separate
  aggregates. The observed latest linked week is not proof that every future
  release will appear on schedule. Acquisition time is not observation time.
- The downloadable weekly table does not provide industry or company rows.
  Investor categories cannot be relabeled as industries or allocated to stocks.

## Rights assessment: distinguish the activity

The [English website terms](https://www.jpx.co.jp/english/term-of-use/index.html)
state that the [Japanese original](https://www.jpx.co.jp/term-of-use/index.html)
prevails. The Japanese general section addresses commercial collection and also
secondary use/redistribution without JPX permission, regardless of charging.
The English text is narrower in wording, so it is not a sufficient basis for
claiming a blanket noncommercial dashboard licence. Both caution against
automatic retrieval that causes high load or high frequency; no numeric rate
limit or unconditional automated-access grant was found.

These distinctions matter:

1. Ordinary viewing of the official downloadable report is different from
   distributing it. The successful one-file inspection verifies accessibility,
   not a redistribution licence.
2. Temporary technical copying for that inspection does not establish the
   rights for a persistent automated feed, cache or derived display.
3. An owner-only dashboard is not public dissemination, but the reviewed pages
   do not expressly resolve whether this automated hosted secondary display is
   permitted. This remains **unconfirmed**, rather than a legal conclusion
   that every personal use is forbidden.
4. Publishing source code does not itself publish financial observations.
   Publishing captured workbooks, snapshots, APIs or derived tables is a
   separate rights question. No such data is added here.

Accordingly the JPX adapter remains disabled/unimplemented. A documented grant
covering the actual hosted caching/display use, or a separately licensed
official product with applicable terms, is needed before enabling it. The
[J-Quants Pro product](https://pro.jpx-jquants.com/datasets/1) is a separate
service, not evidence that the public files have a free unauthenticated API.
No login, paid service or permission request was submitted.

## Alternative

The Ministry of Finance's International Transactions in Securities is a
different Japanese official statistic with explicit government reuse terms.
It measures reported cross-border securities transactions, not JPX investor
categories. See [the MOF source contract](source-jp-mof.md); do not substitute
one series under the other's title or imply comprehensive Japanese domestic
market coverage.
