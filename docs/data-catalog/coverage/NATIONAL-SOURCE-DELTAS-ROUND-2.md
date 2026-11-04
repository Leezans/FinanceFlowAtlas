# National source research additions: second combined round

Evidence date: 2026-11-04. This is source research, not new live data integration.

## Scope and files

- [Europe and Americas, third regional batch](national-europe-americas-delta3.md): 25 additional economies, one source record each. JSON/CSV use the same basename. There are 20 official product/index-level V1 leads, 3 institution/methodology candidates and 2 historical-publication-only V1-H leads.
- [Asia, Africa, Middle East and Oceania, second batch](asia-africa-oceania/round-2/README.md): 29 additional economies and 29 source records, plus JSON/CSV, validation and minimal download-test metadata.
- [Combined validation](round-2-validation.json): the two groups have no economy overlap, no repeated source IDs and no overlap with the prior 54 researched economies. Together the research additions cover 108 distinct economies and 112 source records. These counts describe catalogue research, not available instruments, validated monetary observations or production connectors.
- [Prior-round index](NATIONAL-SOURCE-DELTAS.md) remains unchanged and describes its own original 54-economy scope. Existing readiness matrices, source registry and code are untouched.

## Interpretation

Every record remains `production_readiness=not_certified`. Research dates are not observation timestamps or guarantees of the latest release. A catalogue, report, official methodology page or historical sample does not establish a working API. Download byte counts and hashes describe research checks, not source-data redistribution; no observation values or raw files are bundled.

Kazakhstan's official statistical-information policy permits reuse and publication with attribution; Samoa's statistics page permits use of its statistical tables without restriction and appreciates acknowledgment. Both statements were independently checked against the linked official pages. This does not imply unlimited automated requests, transfer rights to other sources, or normalize monetary values. Other unknown rights remain unknown. Repository licensing does not override source terms.

Keep direct investment, portfolio debt, combined equity/fund transactions, income, IIP positions and securities-market flows distinct. BCEAO country tables are not the regional total copied to individual member states. Samoa's failed spreadsheet link is not repaired by merely finding another report. Papua New Guinea's recorded 403 is not bypassed or retried. Historical observations and monthly publication schedules are not proof of current monthly equity-flow coverage.

Independent link validation uses a single HEAD request per URL, excluding previously failed download URLs. No bodies or raw request logs are retained. Non-success results are recorded in the combined validation and require follow-up before using a link; HTTP success does not certify semantics, rights or data readiness.

Link review covered 78 URLs: 76 HEAD requests were attempted, with 51 HTTP 200 responses, 21 other HTTP outcomes and 4 timeouts; two prior failed download URLs were not retried. Primary-URL 404 results are explicitly marked relocation-required in JSON/CSV. Supplementary broken references remain historical leads, not proof of current access. See validation for exact URLs and statuses.
