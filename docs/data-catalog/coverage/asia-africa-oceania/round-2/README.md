# Second regional source pass

2026-11-04. Single-round research of 29 new economies, with zero overlap against the first 22. Files retain the first-round schema. No country lacking a record is classified as lacking data. No raw observations redistributed.

## Strongest findings

- Kazakhstan: BOP workbook successfully downloaded without login, HTTP 200 (1,037,087 bytes). Metadata has portfolio and equity/fund-share labels. Official data-use policy permits free reuse, publication/distribution with attribution, modification and apps. Private-sector capital-movement worksheet reverses standard BOP asset signs, so worksheet selection is critical. Numeric series, nesting and units are not yet certified.
- Lebanon: official monthly C2 HTML table has separate equity assets/liabilities and debt, in USD million. Month-to-month repeated values and sign methodology need checking before aggregation. Free viewing is not an open reuse license.
- Botswana: detailed BOP XLS successfully downloaded without login, HTTP 200 (117,248 bytes). Legacy XLS was not parsed; exact equity coverage/frequency unknown.
- Samoa: explicit permission to use website statistical tables without restriction, with acknowledgment appreciated. B1 Excel hyperlink exists, but returned HTTP 404. Quarterly bulletin is a separately discovered public PDF candidate, not a tested replacement.
- Papua New Guinea: QEB index current through Q1 2026; BOP XLSX request returned HTTP 403. No bypass attempted.
- Cambodia: Q3 2025 official methodology explicitly says portfolio-investment liabilities are unavailable. Keep missing, never zero.

## Coverage

Asia/Central Asia: Bangladesh, Cambodia, Laos, Mongolia, Kazakhstan, Kyrgyzstan, Tajikistan, Uzbekistan.
Middle East: Lebanon, Israel, Iraq, Palestine.
Pacific: Fiji, Papua New Guinea, Samoa, Solomon Islands, Vanuatu, Tonga.
Africa: Botswana, Namibia, Rwanda, Morocco, Zambia, Togo, Burkina Faso, Mali, Niger, Senegal, Benin.

BCEAO records are country-specific tables or national reports, not regional totals assigned to member states. Portfolio aggregates often contain sovereign debt. Publication cadence does not prove observation cadence. IIP stocks, primary income, direct investment and overseas exchange receipts/payments are not portfolio equity flows.

## Verification

`download-test-metadata.json` contains HTTP outcomes, byte counts, hashes and concise metadata labels only. `numeric_table_opened` is a web read, not a production-adapter guarantee. Search-only evidence remains marked. Every record is `not_certified` for production; rights and machine access are separate dimensions.

