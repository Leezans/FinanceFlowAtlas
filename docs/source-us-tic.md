# U.S. TIC equity transaction connector

## Scope and semantics

This connector reads the U.S. Treasury's **SLT Table 1**, machine column
`for_lt_eqty_net`. These are reported monthly net U.S. sales of U.S. corporate
 equity to foreign residents, equivalent to foreign net purchases. Positive
means money into U.S. equity; negative means net sales/outflow. Negative values
are retained without reversing investor and issuer identities. This is not a
holdings difference, all-asset TIC net capital inflow, global bilateral flow
matrix, exchange turnover, intraday feed or investment signal.

The asset scope includes equity fund shares, not only directly listed shares.
Foreign geography is the reported resident attribution, subject to custodial
and intermediary bias, not ultimate beneficial-owner nationality. The issuer
is U.S.; country codes are Treasury codes explicitly mapped to ISO. Aggregate,
sector, memo, institution and unknown geography rows are excluded from country
observations. Grand Total is retained separately and must not be added to the
country rows. Country rows do not exhaust the total. Missing is never zero.

Only the expanded SLT transaction series from **2023-02** is accepted. No
splicing to legacy Form S. No bond columns or valuation changes are used.
Source integral USD millions are multiplied by exactly 1,000,000 into integer
USD, with no float rounding. Schema/unit/header/code-name changes fail closed.

## Official evidence

- [SLT Table 1, raw machine table](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt)
- [SLT Table 4, gross purchases/sales cross-check](https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table4.txt)
- [Treasury transaction documentation](https://home.treasury.gov/data/treasury-international-capital-tic-system-home-page/tic-forms-instructions/securities-a-us-transactions-with-foreign-residents-in-long-term-securities)
- [Treasury FAQ on direction and revised SLT](https://home.treasury.gov/data/treasury-international-capital-tic-system-home-page/frequently-asked-questions-regarding/ticfaq2)
- [August 2026 release, October 16, 2026](https://home.treasury.gov/news/press-releases/sb0662/)

`period` is the observation month. `observation_release_date` is the verified
release date for that month, not an asserted file-vintage timestamp. It is null
for months without verified release metadata in the adapter. The mutable table
can revise history; `source_revision_published_at` remains null because the
file provides no authoritative revision timestamp. `retrieved_at` records the
fetch, while raw SHA-256 and adapter/geography versions identify the exact
transformation vintage. Do not label retrieval time as publication time.

## Rights

Treasury is the statistical source, not this project's licensor. Preserve
attribution and this source note. U.S. federal government works are generally
outside U.S. copyright ([U.S. Copyright Office](https://www.copyright.gov/history/copyright-exhibit/lifecycle/));
this does not imply a worldwide guarantee, rights to third-party materials,
Treasury marks, endorsement, or application of the repository software license
to all source data. The test fixture contains entirely invented numerical values and is explicitly
labeled synthetic. Full fetched datasets are runtime artifacts and are not committed.

## Run and API

From the project root with the existing Python dependencies installed:

```
PYTHONPATH=packages/core/src python -m financeflow.tic_service --period 2026-08 --data-dir var
```

The explicit month is deliberate: a caller cannot silently relabel an old month
as current. Successful ingestion persists a separate `var/tic.sqlite` and
content-addressed raw bytes under `var/raw/tic/`. Failed fetch/validation retains
the last validated snapshot, marks its source check stale, and exits nonzero.
Older requested months cannot replace a newer active month. The CLI is manual;
no schedule or current-period discovery is claimed.

`GET /api/v1/flows/tic` serves the separate typed snapshot; `/api/v1/flows/tic/status`
returns check status. Empty data returns 503. `X-Data-Status` and `Warning` expose
failed or older-than-48-hour checks; this is **check freshness**, not the age of
the observation or proof that the source is its latest release. ETag includes
snapshot version and check state. The existing IMF API/schema remain unchanged.
No UI arcs or holdings totals consume this dataset yet.

## Real read verification, 2026-11-04

The 972,020-byte official Table 1 payload SHA-256 was
`dbdb9fb062d5f435aa625fd225bd42288029df46be33e84759c4741961e91180`.
August 2026 produced 77 country observations, including 25 negative values;
4 mapped countries had missing values; 32 aggregate/category rows were excluded.
The official grand total was **USD 153,942,000,000**. Canada was
+28,993,000,000, Japan +5,424,000,000, United Kingdom -9,883,000,000 and Austria
+82,000,000 USD. All 77 were cross-checked against official Table 4's
`for_lt_eqty_sale - for_lt_eqty_pur` with zero mismatches. Grand total
5,337,090 minus 5,183,148 million also matched. The release was October 16;
Treasury scheduled the September release for November 18. This is delayed data.

Unit tests use an explicitly labeled synthetic fixture with entirely invented
numerical values, plus mutation cases for rejection and missing/sign behavior. The live network read is separate
from offline tests. No fabricated observations are shipped as production data.

Final verification: 36 combined backend tests passed (20 existing plus 16 TIC).
Independent review reran the suite, checked all 77 Table 4 reconciliations,
and confirmed ISO mapping uniqueness, signed semantics, date/row/truncation
rejection, ETag retrieval/state identity and separation from holdings. The
integrated API returned 200 with 77 TIC records while the uninitialized IMF
endpoint remained 503. Remaining operational limitation: manual ingestion is
intended for one operator; multi-process scheduling and concurrent same-month
vintage ordering are not implemented. No UI wiring, deployment or scheduler
is included in this connector increment.

## Hosted automatic discovery update

The Python manual connector described above remains explicit-month. The hosted
`apps/site` endpoints and chart now discover the latest validated source-table
month and roll the 12-month history forward automatically. See
[hosted discovery, safeguards and verification](tic-latest-discovery.md).
