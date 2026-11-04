# Fourth combined round: source leads, territorial scope and gaps

Research date: 2026-11-04. These additions are not new connected datasets or validated monetary series.

## Counts that must not be combined as sources

- [Europe/Americas source leads](national-europe-americas-delta5.md), with same-basename CSV/JSON: 3 economies, comprising 2 V1 product/page leads and 1 candidate. All series IDs are null.
- [Europe/Americas scope records](territorial-scope-europe-americas-delta5.json), also in CSV: 10 economies/territories. These are statistical-area or unresolved-local-source notes, not sources. Nine have aggregate-area evidence; Greenland has an unresolved local-source gap and is not included in Denmark BOP.
- [Other regions, round four](asia-africa-oceania/round-4/README.md): 53 records, split into 30 national/territory candidates, 1 regional republisher candidate, 10 aggregate-territory notes, 1 historical documented gap and 11 discovery gaps or agency-only leads. A `source_id` on a gap row is only a record identifier, not proof a source exists; use `coverage_status` when counting.
- Overall: 66 new distinct economy/territory records, but only 34 source leads (including the regional candidate). The remaining 32 are scope/gap records and must not be counted as sources.
- [Combined validation](round-4-validation.json) confirms no overlap between these groups or the previously committed research rounds. Across rounds, 220 economies/territories have some research or scope record; 188 have source leads, represented by 192 source-lead records. These are catalogue counts, not production coverage. The regional prior-context list includes 12 baseline-registry leads beyond the 154 economies in earlier combined rounds.

## Statistical boundaries and evidence

BEAC country workbooks must remain country-specific rather than assigning a CEMAC total to each member. Territories included within US, Australian or French statistical areas do not gain their own equity observations merely through that inclusion. SNB documentation includes Liechtenstein in Swiss BOP; this does not establish a separate Liechtenstein series. US BEA ITA scope differs from NIPA/GDP scope and from Puerto Rico's local BOP perimeter. Do not add overlapping local and national totals.

All source leads remain unverified for production; automation and redistribution/display rights stay unknown. No usable numeric series is supplied. Workbook labels and successful binary downloads do not prove the presence or interpretation of populated equity-transaction cells. Stock, direct investment, portfolio income, fund shares and transactions remain distinct.

Historical gaps are dated evidence, not permanent absence claims. Missing URLs are left blank. No fictitious endpoint or zero-valued observation fills a gap. Polar and other unresolved areas remain visible in the wider inventory rather than being described as covered.

Only metadata, brief research summaries and link-check outcomes are published. No raw statistics, response bodies, request logs, private paths, contacts or build scripts are included. The existing country matrix, source registry, code and earlier-round documents are unchanged. Source-data rights are not replaced by the repository license.

Independent link checks make one HEAD request per eligible URL. Previously unsuccessful accesses are not retried; failures, timeouts and skips remain explicit in validation. HTTP success establishes only that link's response, not rights, semantics, completeness or current production availability.
