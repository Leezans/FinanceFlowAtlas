# National source research additions: third combined round

Evidence date: 2026-11-04. These are source leads, not actual series integrations, normalized observations or certified production access.

## Scope and files

- [Europe and Americas, fourth regional batch](national-europe-americas-delta4.md): 18 economies, including 7 V1 product/file leads and 11 candidates. All `series_id` values are null. V1 does not mean a validated equity series.
- [Other regions, third batch](asia-africa-oceania/round-3/README.md): 28 economies and 28 source records, with CSV/JSON, prior-code context, validation and minimal historical download-check metadata.
- [Combined validation](round-3-validation.json): 46 distinct economies this round, with no duplicates between groups or against the 108 economies in the two previously committed research rounds. The three combined rounds contain 154 distinct economies and 158 source records.
- The regional `prior-economies.json` contains 120 codes because its exclusion check also included 12 pre-existing registry leads beyond the earlier research rounds. That larger exclusion list is not 120 certified sources. Do not mix its count with the 108-economy prior-round count.
- [Round one](NATIONAL-SOURCE-DELTAS.md) and [round two](NATIONAL-SOURCE-DELTAS-ROUND-2.md) remain historical indexes of their respective scopes; existing matrix and registry files are unchanged.

## Limits that survive discovery

Every record remains `not_certified`, with automated-access and public-display rights unknown. No actual, validated machine-series mapping or monetary observations are included. Some tables expose equity-plus-fund lines, but instrument nesting, sign, scale, period type, revisions, full history and rights still require validation. A readable file is not an open license.

ECCB member-state compilation evidence does not establish that country tables were acquired. CBCS area coverage does not prove separate observations for each constituent economy. Neither group receives regional totals copied into national records. Historical Afghanistan files are not evidence of a current release. Seychelles legacy and offshore variants must remain separate. Cook Islands' conflicting publication descriptions remain unresolved, rather than being simplified to data absence. Missing values, dashes and unavailable liabilities must not be replaced by zero.

Downloads are represented only by dates, HTTP outcomes, byte counts, hashes and selected schema labels. Raw observations, source responses, personal contacts, private filesystem paths and scripts are excluded. All repository code and existing documents remain unchanged.

The independent link audit makes one HEAD request per eligible URL and records non-successes. Previously unsuccessful accesses described in source metadata are skipped, not bypassed or retried. HTTP 200 is only a link response, not certification of data or source rights; primary 404 links remain relocation-required leads.

Link audit covers 53 URLs; HTTP/status categories and all unsuccessful or skipped entries appear in the combined validation. No previous failure was retried.
