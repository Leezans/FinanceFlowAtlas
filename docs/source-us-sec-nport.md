# SEC N-PORT fund-share subscriptions and redemptions (isolated adapter)

Status: tested against actual 2026Q3 SEC bulk members; not wired to public API/UI,
not an equity-only dataset and not a country-flow edge source. No raw SEC data is
included in this repository. Existing IMF/TIC contracts are unchanged.

## Official evidence and scope

- [SEC bulk catalog](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets)
- [SEC table schema](https://www.sec.gov/files/nport_readme.pdf), FUND_REPORTED_INFO B.6 and SUBMISSION A.3.
- [Form instructions](https://www.sec.gov/files/formn-port.pdf), Item B.6.
- [SEC fair access](https://www.sec.gov/about/developer-resources)

Source fields SALES_FLOW_MON1..3 and REDEMPTION_FLOW_MON1..3 are reported
fund-share issuance/redemption values, in USD. The adapter computes **sales minus
redemptions**, retaining REINVESTMENT_FLOW_MON1..3 separately and excluding it
from that net measure. Values are decimal strings to preserve source precision.
No price/volume or holdings-change inference is used.

This is fund-share activity, not trading by a fund in individual stocks. Funds can
hold bonds, mixed assets, foreign securities, or use in-kind transactions. Do not
label the results as cash-only or U.S. equity investment. Exchanges, mergers,
acquisitions and liquidations may contribute. Omnibus accounts may report net
activity. No fund classification, security-country allocation, investor country,
or whole-market aggregate is inferred. Money-market funds and SBICs are outside
this source's stated scope. SEC warns that as-filed data may contain errors.

## Time, identity and amendments

Join FUND_REPORTED_INFO to SUBMISSION by ACCESSION_NUMBER. Select report month
using REPORT_DATE, not REPORT_ENDING_PERIOD (which is fiscal year-end). Month 1
is two calendar months before report month; month 3 is report month. A quarterly
bulk vintage is the dissemination batch, not necessarily the economic quarter.

FILING_DATE is retained, but not represented as verified public availability.
observation_publication_date remains null. HTTP Last-Modified describes the
current bulk object, not first release of an observation. Record the actual
retrieval timestamp and SHA-256 of both raw members. Do not use this snapshot
for point-in-time backtests without separately verified dissemination timestamps.

Within a single vintage/report month, the latest filing date wins by series ID;
any same-day collision is conservatively excluded because acceptance timestamps
are absent. Distinct report days in one series/month fail validation. Missing
series IDs are excluded rather than joining by a mutable name. The adapter does
not reconcile across vintages. Do not concatenate multiple vintage outputs and
sum them without resolving repeat series/month observations and amendments.

Blank values remain null, never zero. Negative reported gross amounts are
preserved and flagged `negative_reported_gross_flow`; review filings before
interpreting them. No source-data corrections are guessed.

## Retrieval and fair access

`sec_nport_download.fetch(vintage, user_agent)` reads only SUBMISSION.tsv and
FUND_REPORTED_INFO.tsv using validated HTTP ranges and ZIP CRC checks. Supply a
real application/contact User-Agent. It spaces requests at 0.5 seconds, with
20 requests, 32 MB transfer, 16 MB per range, 32 MB per member and 1 GB archive
limits. Coordinate all clients to remain below SEC's aggregate 10 requests/second
limit. Cache locally outside Git. 403/429 and other errors propagate without
retry or bypass. Range refusal, object revision changes and truncation stop the
fetch. The compressed holdings member is never requested.

`source_sec_nport.normalize(submission_bytes, fund_bytes, report_month='2026-06',
vintage='2026q3', retrieved_at='<actual aware ISO timestamp>')` returns a separate
snapshot; pass `source_last_modified` only from actual HTTP evidence.

## Real-source validation (2026-11-04)

Verified https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q3_nport.zip
was 462,371,568 bytes; HTTP Last-Modified was 2026-10-07 16:13:21 GMT. Manual
bounded range retrieval used a 65,536-byte tail plus a 2,390,916-byte prefix,
then verified decompressed member sizes and ZIP CRC32. This validated actual
TSV headers and real parsing; the reusable range-fetch wrapper has mocked HTTP
unit coverage rather than a separate live run.

For report month 2026-06: 6,550 identified series, 19,650 monthly records for
April–June. Exclusions: 7,003 other-report-month rows; 493 missing series IDs;
17 superseded same-series records; 3 same-day ambiguous series. These counts
are cohort coverage, not the entire U.S. fund universe. 87 monthly records have
negative reported gross-value quality flags.

Example: BNY Mellon Appreciation Fund, Inc., series S000000008, accession
0000940400-26-033357, report date 2026-06-30, filed 2026-08-24. April reported
sales $9,148,285.94 minus redemptions $36,488,154.60 = -$27,339,868.66; separately
reported reinvestment $25,647,178.99 is excluded.

Member SHA-256:
- SUBMISSION.tsv: de57ec9567b3dcd930d89c0edb8b4d509420ec0c4f58bf8432375c4a6268506d
- FUND_REPORTED_INFO.tsv: 610e73b607206156107f635bcdcde1e49df27de4962bb6dd5143fd766e36ef55

Public availability does not grant blanket copyright rights to registrant
material, third-party content or branding. Attribution and source links remain;
repository software licensing does not purport to relicense filings.

Tests: `PYTHONPATH=packages/core/src python -m unittest discover -s tests -p 'test_sec_nport.py' -v`.
Only synthetic TSV fixtures are shipped. This isolated adapter is not a deployed
feature and needs API/schema/UI review before publication.

### Review hardening

Amendment candidates are grouped before selection, making any-date collision
exclusion independent of row order (including old same-day collisions followed
by a newer filing). Numeric inputs enforce NUMBER(36,12): at most 24 significant
integer places and 12 fractional places before exact subtraction. Retrieval
rejects all redirects and requires a strong ETag or parseable timezone-aware
Last-Modified. Every range sends If-Range and checks the same response validator.
Thirteen focused tests cover permutation invariance, overflow, excess decimals,
redirects, missing/changed validators, HTTP 200 range refusal, truncation and
403/429 propagation with no retries.
