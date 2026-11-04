# Asia, Africa, Middle East and Oceania source deltas

Research date: 2026-11-04. 26 source records across 22 economies. Additive metadata research only; not a replacement for the 250-entry readiness matrix (249 ISO entries plus XKX), not exhaustive regional certification. Countries without a fresh record retain their prior status; absence is not proof no source exists.

## Use

- `source-deltas.json` / `.csv`: structured official-source leads, tested-page results, explicit semantics/access/rights gaps.

## Highest-value additions

1. Taiwan CBC dataset 6559: official quarterly free CSV, explicitly Open Government Data License v1.0. Equity AND funds transactions with separate assets/liabilities; do not call pure equity. CSV fetched HTTP 200 without login and parsed in memory: 170 quarterly observations, 1984Q1–2026Q2. Units and signs remain unvalidated.
2. Australia ABS Table 13: explicit quarterly financial-account XLSX download. ABS website CC BY 4.0 applies with stated exceptions. XLSX fetched HTTP 200 without login; metadata confirms portfolio equity-and-investment-fund-share assets/liabilities and sector splits. Exact series IDs remain to be established; headline equity includes direct investment.
3. Jordan ASE: directly opened monthly nationality shares bought/sold/net, JD million, with historical monthly sections. Nationality is not residence; no API or redistribution rights established.
4. Sri Lanka CSE: official indexed PDF explicitly displays daily foreign purchases/sales/net. Direct open exceeded web-tool size limit. Unit and continuous archive need verification.
5. Mauritius SEM: directly opened 2025 factbook with monthly 2024 foreign purchases/sales/net separately for Official Market and DEM. Table heading and displayed scale conflict; do not load amounts until resolved.

## Important exclusions and distinctions

- Pakistan SCRA current securities trading includes debt, and cash remittances also differ from purchases. Equity positions do not repair this scope issue. Historical PDF URL opens a current HTML page; not a tested downloader.
- Philippines BSP registered investment cash-flow aggregate is not equity-only.
- Singapore page provides equity/funds IIP stocks; cannot difference them into flows.
- Taiwan TWSE aggregate AMOUNT product is separate from its per-security SHARE-count product. Both paid external subscriptions still prohibit public disclosure. Do not inherit an open-government license from CBC to TWSE.
- SET live HTML returned empty dynamic fields although search index contained numerical million-baht values. Marked accordingly, not certified ingestion.
- Qatar's documented daily nationality/type product is an enquiry service. Its price/free availability is not established; public report headings do not prove a usable numeric feed.
- Tanzania detailed foreign investor data has a separately priced product. Public aggregate participation charts are not equivalent rights or granularity.
- Nigeria report index is visible, but live parsed page did not expose report links. Search-index evidence alone is not a successful monthly download.

## Verification vocabulary

`numeric_table_opened` and `pdf_opened_numeric_tables` mean a current research web tool read actual source content, NOT a production client/API test. `official_search_evidence` means indexed official content only. `candidate` / `unverified` remains an unproven lead. All records keep `production_readiness=not_certified`. No login, purchase, CAPTCHA, communication or dataset publication was performed.

Public readability, no-account access, automation permission and public-display rights are separate. Unknown permissions remain unknown. Rights-positive entries are evidence of publication licenses, not an API service-level or unlimited-request guarantee.

## Direct download checks

`download-test-metadata.json` records HTTP status, MIME type, byte size, SHA-256, schema/labels and period endpoints only. No observation values or raw downloaded files are included. Two research downloads succeeded. These historical checks do not establish ongoing availability or production ingestion.
