# Brazil CVM disclosed fund equity transactions

## Decision and licensing

The `/brazil` industry → security matrix uses two independent official,
free, no-account Brazilian securities-regulator datasets:

- [CVM CDA fund portfolios and transactions](https://dados.cvm.gov.br/dataset/fi-doc-cda)
- [CVM FCA company registration forms](https://dados.cvm.gov.br/dataset/cia_aberta-doc-fca)

Both catalog pages expressly identify the Open Data Commons Open Database
License. This is an actual open-data license, not an inference from anonymous
website access. The derived snapshot retains CVM attribution, ODbL-1.0,
source archive URLs and SHA-256 digests. The complete derived database is
available through the same owner-authenticated snapshot JSON endpoint, under
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Application code
licensing does not replace the database license. No raw provider observations,
private contact details, fund identifiers or company contact records enter Git.

This implementation does **not** request B3 data. Its website's prohibition on
automated collection is not bypassed through alternate B3 hosts. B3 labels and
security codes here are observations independently published by CVM under its
open-data license.

## Metric and strict scope

CDA `VL_AQUIS_NEGOC` is the value of acquisitions during the reported month;
`VL_VENDA_NEGOC` is sales during that month. The difference is **actual reported
fund equity transaction net purchase/sale**, in Brazilian reais, not a change
in portfolio valuation. The official CDA data dictionary supplies field meanings
and decimal precision. The [CDA XML specification](https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/PadroesXML/PadraoXMLCDANetV4.aspx)
separately identifies purchases/sales as R$ and distinguishes them from final
holdings. Its application table distinguishes shares from derivatives, loans,
foreign assets, debt and other fund units. We do not claim this older XML version
is the current submission specification for every fund category.

Current verified filters are deliberately narrow:

- `cda_fi_BLC_4_YYYYMM.csv` only;
- `TP_FUNDO_CLASSE = CLASSES - FIF` only;
- `TP_APLIC = Ações`;
- ordinary/preferred share asset types only;
- exact ticker match to an unambiguous Brazilian issuer's ordinary/preferred
  security in FCA, `Mercado = Bolsa` and administrator `B3`;
- matching FCA issuer ID, document ID, version and reference date in both
  `geral` and `valor_mobiliario` members; industry is exact `Setor_Atividade`;
- stated trading dates must intersect the reported month.

No aliases are inferred from ISINs, names or ticker prefixes. Ambiguous issuers
or conflicting share types are quarantined. Original Portuguese industry keys,
including holding-company categories, are never merged. Chinese display labels
are translations only. The classification is the latest available FCA revision
for the report year **at acquisition time**, not historical point-in-time sector
membership. This can exclude renamed or retired tickers.

This is not all funds, all institutions, foreign-investor activity, complete B3
trading, flows into issuers, or total capital entering Brazil. Opposite trades
between included funds can cancel. The source describes reported portfolio
applications and their monthly transaction fields; we do not assert that the
public rows independently prove completeness of every intramonth transaction.
FIP, legacy/unverified fund types, specialized-fund files, uncoded assets,
units/BDRs, derivatives and lending are excluded rather than assigned proxy flows.

## Missing values, confidentiality and arithmetic

- Ordinary and preferred securities remain separate tickers. Industry totals
  sum only valid disclosed securities, with known/catalog coverage shown.
- FCA securities with no eligible public CDA rows retain null, not zero.
- A missing amount in any included row nulls that security's aggregate.
- A duplicate transaction identity quarantines the affected security rather
  than counting it twice; no fuzzy duplicate elimination is used.
- Monetary arithmetic uses BigInt integer cents and must fit safe numeric
  bounds before entering JSON. Visible aggregate buy/sell totals are also
  bounded so client-side subset addition cannot silently lose cents.
- `cda_fi_CONFID_YYYYMM.csv` identifies confidential stock-category aggregates,
  not securities. Their rows and distinct funds are counted but never assigned
  to an industry. They can overlap the funds with public rows, so the two fund
  counts must not be added as if disjoint.
- Duplicate, null, unmatched and ambiguous counts are retained. Catalog size
  is not a claim of complete Brazilian market coverage.

On 2026-11-05 the anonymous official September 2026 archive (15,640,735 bytes)
and 2026 FCA archive (362,935 bytes) returned HTTP 200. The production parser
verified 15,185 eligible public FIF share rows from 948 distinct fund/classes:
14,592 matched and 593 unmatched; 2,400 confidential equity aggregates were
not assigned to sectors. The unambiguous catalog contained 421 eligible tickers
in 48 exact CVM industries, with 269 tickers having valid public transaction
amounts. These are coding-runtime validation counts, not deployment proof.
The source can revise them. No source monetary observations are bundled here.

## Timing and acquisition

The source refresh policy updates its newest three months daily and older
months weekly. The application checks no more than once per day and requests
**M−2** in UTC, leaving one complete intervening month instead of promoting a
newly started disclosure month. This is an application policy, not a guarantee
of completeness. Confidentiality, late filings and subsequent revisions remain.

Only two deterministic `https://dados.cvm.gov.br/dados/` archive URLs are used.
FCA is downloaded first (2 MB budget), then CDA (40 MB budget), with omitted
credentials, manual redirects and one shared 60-second deadline. ZIP handling
validates central/local headers, member ranges, supported compression, CRC32,
decoded lengths, no duplicate members, and no ZIP64/encryption/multidisk input.
Selected CSV members are streamed through bounded deflate and Latin-1 parsing.
No full 40 MB decoded table is retained. Limits include 70 MB/member,
120 MB total selected decoded bytes, 400,000 CSV records and bounded fields.

An independent D1 `cvm_source_gate` holds a normalized public snapshot and
coordinates collection. It never reads/resets prior source acquisition gates.
A denied/redirect/challenge response durably blocks collection and clears its
cache; no alternate hosts, source switching or automatic reset exist. A busy or
uncertain lease is not taken over. Owned admission/release operations retain
request lifetime through cancellation. Transient errors retain only age-valid
last-good evidence and honor a longer Retry-After.

Observation month, classification acquisition date and successful retrieval time
are distinct. Official publication time remains null. Reports older than 100
days are stale and older than 180 days hidden. Retrieval caches older than seven
days are hidden independently. Browser expiry continues while a tab is hidden.
A failed refresh never renews the last-success timestamp.

The [organized evidence panel](organized-report-projection.md) below the existing
heatmap offers a bounded preview and local JSON export of this same validated,
still-visible snapshot. It preserves integer `BRL_cents`, exact security/industry
identity, non-point-in-time classification, archive hashes and missing aggregates.
Buy/sell are labeled as the original adapter's sums, net as its difference, and
no new industry or market totals are added. The full export is independent of
industry filters and uses the same seven-day/180-day visibility limits, including
a final click-time check. It adds no acquisition, API, storage or private fields.

## Integration and verification

Migration `0009_cvm_monthly_fund_gate.sql` and its generated journal/snapshot
follow canonical ASEAN FDI 0008 and TPEx 0007. It creates and seeds only the new
CVM gate. Never rewrite a deployed migration or use this change to reset
another gate.

Tests use synthetic ZIP/CSV only:

```sh
cd apps/site
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run test:cvm-runtime
```

The native runtime test uses workerd/D1 with real source requests disabled.
It exercises actual ZIP decoding, exact joins, cold/warm worker caching,
permission stops, request cancellation and unchanged prior source gates.
An additional offline native run using the already-downloaded full September
archives returned HTTP 200 in 2.53 seconds (2.40 seconds parsing), with exact
Node-parser and persisted D1 payload agreement for all 421 securities. The
temporary full-archive harness and observations are not part of the repository.
Deployment, production migration, live-host acquisition and authenticated
browser QA remain separate verification steps owned by the integrator.
