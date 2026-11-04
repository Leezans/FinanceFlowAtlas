# National source research additions, 2026-11-04

This index links additive source-discovery metadata, not working production connectors or certified market coverage. Existing country-readiness and national-source-registry files are unchanged.

## Files and scope

- [Europe and Americas, first batch](national-europe-americas-delta.md): 22 economies and 22 source records; JSON and CSV have the same basename.
- [Europe and Americas, second batch](national-europe-americas-delta2.md): 10 further economies and 10 source records. Poland is included here although it remained unresolved in the first batch.
- [Asia, Africa, Middle East and Oceania](asia-africa-oceania/README.md): 26 source records across 22 economies, with JSON/CSV, validation and two download-metadata checks. Taiwan, Japan, Jordan and Tanzania each have two distinct source records; these are not duplicate economies to sum.
- [Combined validation](delta-validation.json): 58 unique source IDs, 54 distinct economies. The two regional groups have no economy overlap. All 54 economies already occur in the existing 250-entry matrix (249 ISO entries plus XKX); this adds research detail, not 54 new countries to the universe.

## Evidence and limitations

All records retain `production_readiness=not_certified`. Research dates are evidence dates, not market observation dates, latest release guarantees or production freshness. Official-page and search-index evidence does not establish that a data endpoint works. HTTP success alone does not establish semantics, sign, currency, scale, automation rights or redistribution permission.

Europe/Americas source discovery has 31 page/index-level V1 records and one institution-level candidate (Slovakia). The region files preserve the difference between explicit equity fields, combined equity/fund fields and unresolved portfolio aggregates. Asia and other regions likewise distinguish downloaded metadata, opened tables, indexed evidence, empty dynamic pages and inaccessible reports. No raw observations, source response bodies, personal contacts or credentials are bundled.

Taiwan CBC dataset 6559 explicitly lists a free Open Government Data License v1.0 publication; ABS states CC BY 4.0 with exclusions for third-party and other specified materials. These two publication-license statements were checked against the linked official pages. They do not establish unrestricted automated access and do not transfer to other agencies or exchanges. Unknown permissions stay unknown. Repository code licensing does not replace source-data terms.

National BOP, equity-plus-fund flows, securities trading by investor nationality, holdings and cash remittances are different metrics. Do not combine them into a global stock-market flow total. In particular, a stock series must not be differenced into transactions, and a source lead is not evidence of local industry or security-level coverage.

The independent link check uses HEAD only, without retrying denials or downloading datasets. Its results are summarized in `delta-validation.json`; non-successes remain unverified and do not alone prove an official source is unavailable. Source URLs remain research references, not certified live integrations.

HEAD checks covered 61 distinct official/rights/download URLs: 51 returned 200; 10 returned non-200 (3×403, 1×404, 1×500, 1×501, 4×503). The Austrian primary URL returned 404 and its access status is explicitly downgraded to relocation-required. These results do not override historical research or authorize retries of blocked access.
