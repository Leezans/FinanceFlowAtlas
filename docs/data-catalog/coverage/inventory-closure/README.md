# Country inventory closure

Checked 2026-11-04. Metadata only, no monetary observations or raw data. Existing catalogue, matrix and application files are unchanged.

The 250-entry universe is 249 ISO 3166-1 entries plus the XKX Kosovo entry (XKX is a project extension, not an official ISO 3166-1 code). Previous combined research rounds contain 220 distinct codes. The baseline source registry adds 12 codes absent from those rounds, making 232 already represented, not 220. This delta adds exactly the 18 remaining codes, with zero overlap, so all 250 have a catalogue, scope, or explicit unknown record. This is not 250-country data coverage.

New statuses: 2 official BOP candidates (Kosovo and Turks and Caicos); 2 aggregate-territory notes (Aland in Finland; Svalbard/Jan Mayen in Norway); 3 exclusions from UK BOP with local series unresolved (Jersey, Guernsey, Isle of Man); 2 verified compiler agencies with current equity series unresolved (Belarus, Venezuela); 1 historical gap (BVI, explicitly dated 2017); 8 discovery gaps. No new production-certified series.

Candidate source identifiers are assigned only to the two actual BOP leads. Scope and gap records have null source_id and series_id. Every independent equity-series status remains unknown. No absence of an independent series is asserted based only on failed search, population, political territory, currency, GDP, trade or an agency homepage.

Deduplicate by economy_code when counting countries. Existing research-round repeated codes are JPN, TWN, JOR and TZA. Baseline-registry repeated codes are BRA, JPN and IND. Ten baseline codes overlap prior rounds; 12 appear only in the baseline. Full lists are in inventory-reconciliation.json. Multiple genuine source records can remain, but must not inflate country counts.

Evidence was reviewed through official/institutional web search results and targeted page opens; no binary equity table was parsed. Turks and Caicos page opened with 2014-2025f BOP and 2014-2025 IIP, updating the search index snippet that still showed 2024. Belarus BOP metadata route showed a generic page shell; Venezuela BOP route was inaccessible through the web tool. Other verified metadata supports compiler identification only. All automation and display rights remain unknown.

Deliverables: inventory-closure-delta.json, matching CSV, and inventory-reconciliation.json. Existing source registry, country-readiness matrix, code and previous deltas remain untouched.

Integration review recomputed the universe, all prior delta codes and the baseline registry directly from the public repository commit recorded in inventory-reconciliation.json. The 18 new codes exactly fill the previously unrepresented set, with no overlaps or out-of-universe additions. CSV list fields use JSON encoding. Independent HEAD checks found 17 successful evidence URLs and one HTTP 503; failures remain unverified, not proof of data absence. 250/250 means an inventory record only, never 250/250 usable data.
