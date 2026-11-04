# National source deltas, round 3

Checked 2026-11-04. 28 new economies. Compared against all 120 economy codes present in the baseline registry and both prior regional research streams, which includes 12 baseline-registry economies beyond the 108 economies in the two prior research rounds. No overlap. The prior-code snapshot is included for reproducibility.

## Useful verified findings

- Mozambique: official quarterly PDF annex2 page30 contains equity plus investment-fund transactions on portfolio asset and liability sides, distinct from debt, USD million, Q1–Q3 2025 and cumulative. Combined equity/funds, not pure equity. Parsed PDF text repeats the table, requiring deduplication. No raw values saved.
- Seychelles: actual no-account XLSX download HTTP200, 440246 bytes. Metadata includes quarterly BPM6 offshore-inclusive and exclusive variants plus legacy BPM4/BPM5. Portfolio assets/liabilities and debt labels present. A separate equity label does not establish its hierarchy; exact equity mapping remains unverified.
- Afghanistan: actual no-account XLSX download HTTP200, 45374 bytes, BPM6 transaction and portfolio labels, USD million. URL is dated2021; current coverage/date range and equity split not validated. Public file existence supersedes any simplistic claim of no published BOP, but does not prove fresh data.
- Cabo Verde: public quarterly XLS index2012Q1–2026Q2 opened. Direct file returned HTTP503. Web reader's unsupported binary response must not be misreported as a successful parsed file.
- Tunisia: official SDMX index found; direct web open502. No tested SDMX feed.
- Brunei: opened annual/half-year BOP aggregate table, no equity split; liability dashes and headline/table inconsistency remain unresolved.
- Cook Islands: public page says capital/financial accounts are unpublished but also gives financial-account summary. Keep documentation-conflict status, not a blanket absence claim.

## Other source candidates and gaps

Egypt, Nepal, Maldives, Bhutan, Zimbabwe, Eswatini, Liberia, Ethiopia, Burundi, Timor-Leste, Macao, French Polynesia, New Caledonia, Armenia, Georgia, Azerbaijan, Algeria, Yemen and Uganda have official country-specific publication/index leads. These are explicitly search-only unless marked otherwise. Iran is an official IMF country-metadata lead; no national data endpoint was verified. Lesotho has an official annual report plus an opened hosted portal attributing statistics to CBL, but official inbound link/ownership of the hosted portal was not established.

No paid access, accounts, registrations, or external communications used. Public access does not establish automated extraction or redistribution rights: no new open license was verified in this pass, and all rights stay unknown. All28 entries remain not_certified. None is production-ready. Missing entries/dashes are never filled with zero; IIP stocks, direct investment, portfolio aggregates and payment flows are not relabeled pure portfolio equity.

## Artifacts

- source-deltas.json / source-deltas.csv: same record schema as earlier Asia passes, links and precise verification statuses.
- download-test-metadata.json: three attempted downloads, HTTP result, hashes, byte sizes and limited nonnumeric metadata where successful. No raw data files.
- prior-economies.json and validation.json: coverage and no-overlap check.

Next work is source-by-source validation of instrument nesting, units, signs, period types, revision policy, full time range and reuse rights. Do not promote search evidence to tested download status or binary downloads to normalized data.
