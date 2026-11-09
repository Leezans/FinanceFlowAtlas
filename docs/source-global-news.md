# Global news and official scheduled events

## Product scope

The hosted `/news` workspace is a small, attributable **official-source feed reader and release-calendar view**, integrated with FinanceFlowAtlas navigation. It is not comprehensive global journalism. Its eleven reviewed sources comprise seven news publishers: Taiwan National Science and Technology Council (NSTC), Japan Digital Agency, the US Federal Reserve, NIST, UK FCDO, Hong Kong SAR Government Information Services Department and European Central Bank (ECB), plus four calendars: US Bureau of Labor Statistics (BLS), Eurostat Euro indicators, Eurostat science/technology/digital-society releases, and European Union institutional events. Coverage extends beyond US/UK sources but remains limited: the Hong Kong feed does not establish mainland China or pan-Asian coverage, and ECB releases do not establish complete European or international coverage. An official statement remains the publishing institution's statement, not independently verified reporting. The Hong Kong general feed includes routine government announcements, so it has a supplementary **政务综合 / official** category rather than automatically labeling every item as finance or geopolitics; no importance ranking is claimed. Chinese and English source titles/excerpts remain in their original language inside a Chinese interface; no unverified AI translation, forecast, sentiment score, price-effect claim or fabricated event is generated.

The public-source acquisition endpoint is `/api/news`. Existing site authentication is unchanged. No API keys, paid subscription, scheduled job or alert service is required or installed. The persistent gate requires the existing primary D1 binding and migrations `0024_news_source_gate.sql` `0025_news_europe_calendars.sql` and `0026_news_asia_technology.sql`; missing binding/schema fails closed without upstream requests. The migration is prepared locally, not applied to any remote database by this work. Opening/refetching the page can acquire sources. Closing it stops the page's requests. The application does not promise unattended monitoring or timely delivery of breaking news.

## Reviewed sources and reuse

Review date: **2026-11-09**. Text headlines, source-provided short excerpts where permitted, source links and schedule metadata only. ECB, Taiwan NSTC and Japan Digital Agency are metadata-only: title, original link and source publication time, with no description reproduced. No photographs, official seals/logos, full articles, third-party enclosures or article pages are downloaded. Attribution and terms links are included in every source status and shown in the workspace. All source relationships are informational; no endorsement is implied.

| Source / category | Fixed feed | Source and reuse evidence |
| --- | --- | --- |
| Federal Reserve Board / finance | [All press releases RSS](https://www.federalreserve.gov/feeds/press_all.xml) | [Official feed directory](https://www.federalreserve.gov/feeds/feeds.htm); [Board disclaimer](https://www.federalreserve.gov/disclaimer.htm): Board information is public domain unless otherwise indicated; cite the Board and exclude third-party material and protected seals. This does not assume regional Reserve Bank content has the same terms. |
| NIST / technology | [NIST News RSS](https://www.nist.gov/news-events/news/rss.xml) | [Official RSS directory](https://www.nist.gov/coo/nist-rss-feeds); [NIST non-SRD works policy](https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications): employee works generally have no US copyright; NIST grants royalty-free worldwide reuse to the extent it holds foreign copyright, with attribution and modification notice. SRD, separately credited works and images are not included. See the notice below. |
| UK Foreign, Commonwealth & Development Office / geopolitics | [News and communications Atom](https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=foreign-commonwealth-development-office) | [Official filtered news page](https://www.gov.uk/search/news-and-communications?organisations%5B%5D=foreign-commonwealth-development-office); [GOV.UK terms](https://www.gov.uk/help/terms-conditions) expressly allow OGL content reuse and feeds for other applications. Attribution: “Contains public sector information licensed under the Open Government Licence v3.0.” Credited third-party works are excluded. The general organisation activity feed was tested but deliberately replaced by this official news/communications feed to avoid filling the geopolitical panel with routine travel-advice updates. |
| BLS / future finance releases | [Official ICS calendar](https://www.bls.gov/schedule/news_release/bls.ics) | [Official schedule and subscription](https://www.bls.gov/schedule/); [Copyright policy](https://www.bls.gov/opub/copyright-information.htm): published text/data are public domain, except copyrighted photographs/illustrations, with source acknowledgment requested; the emblem is protected. |
| Hong Kong SAR Government / Information Services Department / official | [General English RSS](https://www.info.gov.hk/gia/rss/general_en.xml) | [Official DATA.GOV.HK dataset resource](https://data.gov.hk/en-data/dataset/hk-isd-gnmis-gnmis/resource/751b5a45-5c70-4ccb-9aff-d18fdcf2750e); [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions) allow free commercial/non-commercial reuse with source, intellectual-property and DATA.GOV.HK acknowledgment. Government/ISD attribution is retained. Only general government-release links under `www.info.gov.hk/gia/general/` and a maximum 360-character feed excerpt are displayed; no linked article or image is fetched. `HKG` denotes Hong Kong publisher context, not mainland coverage. |
| European Central Bank / finance | [Press RSS](https://www.ecb.europa.eu/rss/press.html) | [Official RSS directory](https://www.ecb.europa.eu/home/html/rss.en.html); [ECB disclaimer and copyright terms](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html) permit accurate attributed reuse, with modification disclosure and a notice that ECB information is available free on the ECB website, including when part of paid products. The directory describes a combined feed including speeches, interviews and press-conference transcripts. This adapter keeps only `/press/pr/` press-release links and title/link/date metadata, suppresses all feed descriptions and excludes separately authored papers, speeches and other publication paths. The live distribution of item paths was not inventoried; excluded paths are counted in parser warnings, and an all-excluded response is unavailable rather than fabricated coverage. |

The [OGL v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) original page returned HTTP 403 to the research reader during this review; it was not retried through another route. The source's directly accessible GOV.UK terms and page footer explicitly identify the licence and feed reuse. This is not a general grant to republish all linked material or a substitute for reviewing terms when adding a new source.

## Date and evidence semantics

- Hong Kong RSS item `pubDate` includes `+0800` and ECB items include explicit offsets such as `+0100`; those item offsets determine normalization. Channel-level `pubDate` is not an item publication timestamp. A missing item timestamp stays unknown even when the channel has a date.
- News `publishedAt` is a source publication timestamp, or a source update timestamp when `publicationTimeKind` is `updated`. An Atom `<updated>` field is never labelled as original publication. Missing or floating timestamps stay unknown. A source date without time remains `publishedDate`, not an invented midnight instant. `occurredAt` is always null: publication is not evidence of event occurrence.
- `fetchedAt` is successful acquisition time, `lastAttemptAt` is the actual persisted request attempt time, preserved for busy/blocked rows and null when no attempt is known; `generatedAt` is response assembly time. None is substituted for a source timestamp. `nextRefreshAt` is the earliest permitted next acquisition on a subsequent request, not a scheduled job or guaranteed delivery time.
- Calendar `DTSTART` supplies a source date or timestamp, not independently verified occurrence or session-start time. `DTSTAMP` / `LAST-MODIFIED` are revision metadata and are not treated as publication. UTC timestamps and explicit IANA timezones are supported. BLS's actual `US-Eastern` identifier maps to `America/New_York` with DST rules. Ambiguous/nonexistent civil times, unknown zones and floating local times are skipped with a visible warning.
- Date-only events preserve dates and the exclusive ICS `DTEND` in `endDate`; they have no synthetic UTC instant. The view includes events starting in the next 90 days and source intervals whose exclusive end has not passed. It does not independently verify that an activity is underway. Date-only filtering uses reviewed calendar timezone context when configured, otherwise UTC as a disclosed date-window convention; DATE itself carries no source timezone. The UI displays known instants in `Asia/Shanghai`; this does not imply Shanghai was the source timezone.
- Cancelled/tentative future entries remain explicitly labelled. Same-source UID revisions select the greatest valid nonnegative integer `SEQUENCE`, then latest revision timestamp. Unsupported recurring/exception schedules are skipped and disclosed, never expanded into guessed events. This first adapter does not infer meetings from RSS publication dates or maintain a hard-coded future calendar.
- News are limited to the preceding 30 days when dated; unknown-date records remain labelled unknown. Future-dated news are omitted. Each source contributes at most 60 current-window items. An empty successful source is distinct from an unavailable source and does not prove that no real-world news/event exists.
- Deduplication uses normalized canonical news URLs, removing only fragments and known tracking parameters. Equal titles on different URLs are not merged and are not evidence of corroboration. Calendar identity and start are retained in addition to its URL, because BLS releases can share one schedule link. UID revision consolidation is not a claim of corroboration; the response dedup counters describe final URL/identity duplicate removal, not a count of source revisions.
- Category comes from the reviewed source. The original technology, geopolitics and finance categories remain first; the supplementary official category preserves the broader scope of the Hong Kong general-government feed. News and BLS region tags combine publisher geography with simple literal title matches; the three European calendars retain reviewed EU context without title-derived market-series associations. Related-market keys are topic/navigation context in the existing catalog (`fx`, `cftc`, `kraken`), not predictions, causal price/flow effects, complete geographic tagging or investment advice.

## Candidate gaps, not enabled sources

No feed or item is invented to fill geographic gaps. Mainland China, most of Asia, and broad international reporting remain uncovered. Additional candidates reviewed on 2026-11-09 are not in the executable allowlist:

- **China NBS:** the Chinese RSS response exceeded the unchanged 1 MiB bound and used timezone-free, nonstandard publication strings. Its [terms](https://www.stats.gov.cn/english/nbs/200701/t20070104_59236.html) permit limited good-faith quotation, not blanket commercial syndication. The English candidate failed XML parsing. Neither is enabled, and no timezone is silently supplied.
- **Bank of Japan:** RSS was reachable, but [copyright terms](https://www.boj.or.jp/en/about/copyright.htm) require permission for commercial reproduction. Not enabled.
- **WTO:** RSS was reachable, but [copyright terms](https://www.wto.org/english/info_e/copyrights_permissions_e.htm) require commercial permission and conditions for noncommercial reuse. Some timestamps had midnight values without corroborated release-time precision. Not enabled.
- **UN News:** RSS was reachable, but official terms pages returned HTTP 403; reuse permission remains unverified. No denied endpoint was bypassed. Not enabled.

These candidates are published-news feeds, not verified future-event calendars. BLS, both reviewed Eurostat feeds, and EU institutional events are the four enabled calendars; ECB/Hong Kong news timestamps are never turned into future schedules.

## Acquisition and failure behavior

`apps/site/lib/news/sources.ts` is a closed reviewed allowlist. Query parameters and feed-supplied links cannot select a fetch target. Only the eleven configured feed URLs are requested. Redirects are never followed. Article links must use HTTPS, contain no credentials or nondefault port and match an exact reviewed source host; no scripts or remote enclosures execute.

The service concurrently acquires the eleven feeds with an 8-second whole-request deadline (including streaming body), 1 MiB maximum decoded body per source, strict UTF-8 and bounded record/nesting counts. RSS/Atom uses the installed `saxes` parser, rejects DTDs/external entities and malformed XML, validates namespace/root structure, and emits inert plain text only. ICS parsing supports a deliberately limited non-recurring event subset, unfolds lines, validates dates/timezones and bounds lines/records. Nothing in a feed is executed or treated as an instruction.

The **primary-D1 persistent gate** stores a separate row for each of the eleven sources, including bounded last-good evidence, next allowed attempt, lease and permission state. Every request checks shared state before serving evidence. Atomic conditional acquisition prevents different Worker isolates from acquiring the same source simultaneously. Same-isolate requests also coalesce in memory. A confirmed acquisition is required before fetching; a missing/unknown row, failed read, or uncertain acquisition acknowledgment performs no upstream request. Busy leases never expire or automatically transfer ownership, even after a Worker restart. A confirmed release publishes the cache and refresh deadline together; failed/uncertain release acknowledgment is not retried and does not expose unconfirmed data.

The minimum interval is 15 minutes. Cooldowns must be valid finite integer durations of at most seven days. An invalid or longer provider deadline is not shortened: release is refused and the durable lease remains busy, preventing an earlier retry. D1 operations have a five-second caller deadline; a late/uncertain acknowledgment does not authorize a fetch or retry. A whole-request timeout leaves its lease busy because aborting does not prove an upstream operation stopped; late fetch/body completion cannot publish evidence or trigger a new attempt. Browser five-minute checks/manual refresh do not bypass it. Busy and blocked rows suppress old evidence. Unknown permission state also suppresses evidence. The gate uses database time for persisted attempt/acquisition and cooldown timestamps; response assembly and item-window filtering use application time. Operational recovery of stuck/busy or blocked rows requires separate review and authorization; this module provides no automatic reset or takeover.

Transient network/format/5xx failures retain successful evidence for at most 24 hours with `stale` status, the original acquisition timestamp and the current error. Expired evidence is suppressed even during a long cooldown. HTTP 429/503 `Retry-After` is respected. Absolute HTTP-date deadlines are retained as absolute instants and compared against database time, so application-clock skew cannot shorten a provider deadline. Explicit 401/403/451, any redirect, or an HTML access challenge suppress prior rows and stop automatic retries **durably across isolates sharing the primary D1 database**. A confirmed denial clears persisted prior evidence; if acknowledgment is lost, the service returns no evidence and does not retry the write or fetch. Broken/hanging stream cancellation cannot convert a known denial into a transient retry. The implementation does not change identity, switch domains, proxy, solve challenges or retry through alternate routes.

The API returns 200 for successful/partial coverage and 503 with the same structured `NewsSnapshot` payload when all sources are unavailable. Every source reports status, warnings, acquisition and attempt times, next allowed attempt (null if halted), terms, attribution and visible item count. Responses use `Cache-Control: no-store`. A stale/partial response is never passed off as newly published evidence.

## Verification

- Runtime smoke on 2026-11-09: the actual Fed RSS, NIST RSS, FCDO Atom and BLS ICS endpoints returned HTTP 200 without redirects. Their original content types were XML/RSS, RSS, Atom and `text/calendar`. The complete `NewsService` parsed all four successfully, producing 28 news/official-update entries and 20 future BLS releases in that observed window. Those counts are a point-in-time check, not fixtures or coverage guarantees. The final FCDO news/communications URL was separately fetched and parsed successfully (20 entries, no warnings) before replacing the broader activity feed. No captured headlines/schedules are bundled or used as fallbacks.
- Expansion runtime probe on 2026-11-09: anonymous HTTPS GET plus XML inspection returned Hong Kong RSS HTTP 200 (`application/xml`, 412,498 bytes) and ECB RSS HTTP 200 (`application/rss+xml`, 5,867 bytes). These source-access observations are not a claim that the expanded application service, durable gate or production deployment was end-to-end verified; synthetic contract tests separately cover the new item shapes and exclusion rules. No live source text is committed.
- The web research reader's “unsupported content-type” result for raw RSS/Atom/ICS was not treated as runtime success. The HTTP/parse smoke above was a separate actual runtime check. Production Worker egress can differ; a local pass does not certify hosted deployment availability.
- Automated tests are synthetic and perform no external network requests. The service unit suite uses an explicit in-memory gate double for clock-driven scenarios; this is not evidence of SQL atomicity. Native-D1 runtime coverage is evaluated separately. Run from `apps/site`: `npx vitest run --config vitest.config.ts tests/news-ingestion.test.ts tests/news-service.test.ts tests/news-route.test.ts`. They cover XML/ICS safety and dates, unknown timestamps, DST transitions, canonical-link dedup, UID revisions/cancellation, recurrence skipping, complete/partial/empty failure, bounded bodies/deadlines, coalescing, cache expiration, permission stops including cancellation failures, Retry-After and API status.
- Native D1 verification: `npm run test:news-runtime` runs production gate/service code in local workerd with external networking disabled. It covers eleven migration rows; missing binding/schema; three-isolate shared races; persistent denial and cache suppression; no busy takeover; stale leases; acquire/release and denial acknowledgment loss; absolute Retry-After under isolate clock skew; excessive cooldown; late fetch; hanging body/D1; and unchanged pre-existing tables. These are synthetic runtime checks, not provider-access or deployed-database verification.
- Synthetic migration regressions also passed `npm run test:deribit-runtime` and all 55 scenarios in `npm run test:taifex-options-runtime`, preserving the 22-table schema and unrelated provider rows after adding migration 0024.
- Local recovery verification on 2026-11-09 passed TypeScript (`tsc --noEmit`), ESLint, production build plus asset-manifest verification, and all 196 Vitest files / 3,295 tests (`vitest run --config vitest.config.ts --maxWorkers=2`). The first higher-concurrency run had two unrelated matrix UI timing failures; both passed their focused rerun and the complete lower-concurrency rerun. The news service suite also verifies unknown/preserved request timestamps. A repository change is not a production deployment.

## NIST non-SRD notice

Source: National Institute of Standards and Technology (NIST). The application removes feed formatting and shortens source-provided text (modification introduced 2026-11-09); it does not present these excerpts as NIST-endorsed analysis. The NIST policy supplies this notice for distributions of non-SRD employee works:

> This data/work was created by employees of the National Institute of Standards and Technology (NIST), an agency of the Federal Government. Pursuant to title 17 United States Code Section 105, works of NIST employees are not subject to copyright protection in the United States. This data/work may be subject to foreign copyright.
>
> The data/work is provided by NIST as a public service and is expressly provided “AS IS.” NIST MAKES NO WARRANTY OF ANY KIND, EXPRESS, IMPLIED OR STATUTORY, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT AND DATA ACCURACY. NIST does not warrant or make any representations regarding the use of the data or the results thereof, including but not limited to the correctness, accuracy, reliability or usefulness of the data.
>
> NIST SHALL NOT BE LIABLE AND YOU HEREBY RELEASE NIST FROM LIABILITY FOR ANY INDIRECT, CONSEQUENTIAL, SPECIAL, OR INCIDENTAL DAMAGES (INCLUDING DAMAGES FOR LOSS OF BUSINESS PROFITS, BUSINESS INTERRUPTION, LOSS OF BUSINESS INFORMATION, AND THE LIKE), WHETHER ARISING IN TORT, CONTRACT, OR OTHERWISE, ARISING FROM OR RELATING TO THE DATA (OR THE USE OF OR INABILITY TO USE THIS DATA), EVEN IF NIST HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

See the linked [NIST policy](https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications) for the complete current terms and exclusions.

## European calendar expansion (2026-11-09)

Three additional reviewed calendar feeds extend the previously BLS-only calendar. This is
selected official coverage, not a comprehensive global or political summit calendar.
Eurostat technology entries are statistical releases, not product launch predictions.

- Eurostat Euro indicators: https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=0&category=2
- Eurostat science, technology and digital society: https://ec.europa.eu/eurostat/o/calendars/eventsIcal?theme=9&category=0
- EU institutions' events: https://european-union.europa.eu/node/406/ical_en

Official discovery/landing pages: Eurostat's
https://ec.europa.eu/eurostat/web/products-eurostat-news/w/wdn-20260105-1
and https://european-union.europa.eu/news-and-events/events_en.
Reuse review: https://ec.europa.eu/eurostat/help/copyright-notice (Commission
attribution/reuse policy), https://european-union.europa.eu/legal-notice_en
(CC BY 4.0). Only titles and calendar metadata are reproduced, with attribution,
modification notices and no endorsement. No descriptions/images are republished.
Event links go to the reviewed landing page, never arbitrary per-event hosts.

Eurostat DATE values retain their date and Europe/Luxembourg calendar-filtering
context. DATE itself carries no timezone; the UI does not label this context an
original timezone. Multi-day DATE intervals remain visible until their exclusive
end date in that filtering context, without converting to timestamps. No hour is
invented. Missing status is conservatively tentative because the feed lacks
confirmation evidence and Eurostat confirms the next week's schedule on Friday.
An explicit cancellation or confirmation is preserved. EU UTC timestamps may
encode multi-day date boundaries rather than session starts: preserve the exact
source instant and end, label it source calendar time, disclose that it is not a
verified session start, and link back to the source. Multi-day timestamp ranges
remain visible until their exclusive end; this is not verification that the event
is taking place. Informational calendar notices are separate from fetch warnings,
so successful retrieval is not incorrectly reported as a partial failure.
All three carry EU calendar context and no automatic title-based economic-series
mapping. Date-only UI wording says the specific time was not supplied, not that
a statistical release lasts all day.

One ordinary anonymous request per feed previously returned HTTP 200. Captured
bodies (135377 / 26594 / 30706 bytes) parsed locally as 463 / 81 / 43 events,
with 38 / 5 / 40 start dates in 2026-11-09 through 2027-02-07. These are retrieval
observations, not a promise of availability or a live result. No additional live
request or bypass of a denial was made during implementation. Synthetic tests
cover the same structural shapes without storing real event fixtures in the repo.

Migration 0025 rebuilds only the news gate allowlist, copying all old columns
unchanged, including busy leases, blocked states, payloads and cooldown clocks.
It seeds only the three new IDs. Before migration, missing source rows fail
closed without upstream requests. It must run through the normal atomic migration
path; no remote migration or deployment was performed for this change.

## Asia technology expansion (2026-11-09)

Two official sources add selected Taiwan research-policy and Japan digital-government
updates. Both include routine administration, not only major technology events.
Category or keyword does not establish importance or market relevance. Both retain
publisher geography (TWN/JPN) without title-derived market/region associations.
Original Chinese/English titles remain untranslated. Coverage is not pan-Asian.

- Taiwan NSTC: https://www.nstc.gov.tw/nstc/rss/newsdata, from the official directory
  https://www.nstc.gov.tw/folksonomy/rss. Terms:
  https://www.nstc.gov.tw/folksonomy/detail/858cc36c-51c8-4772-a749-3fb22fcf8fc1?l=en
  (Open Government Data License, version 1.0, Taiwan). Attribution required;
  specially marked permission-required material, third-party content, logos and
  personal data excluded. Only title, official link and source publication time.
- Japan Digital Agency: https://www.digital.go.jp/en/rss/news.xml. Terms:
  https://www.digital.go.jp/en/resources/open_data/public_data_license_v1.0
  (Public Data License 1.0). Attribution and modification disclosure retained,
  third-party material excluded, no endorsement implied. Title/link/time only.

No descriptions, images, linked article text or enclosures are republished.
Prior anonymous research observed HTTP 200, approximately 181 KB and 13 KB
respectively. NSTC item dates include GMT and Japan dates +0900. Source offsets
are normalized without replacing them with a local timezone. Missing item dates
stay unknown; channel dates are not used. Prior access observations are not a
hosted runtime guarantee. No additional provider request or live text fixture
is part of this implementation.

Migration 0026 extends the closed gate ID constraint and seeds only the two new
sources. Every prior row field is copied unchanged, including blocked state, busy
lease, cached payload and clocks. Missing rows fail closed before atomic migration.
The fifteen-minute minimum refresh, durable denial stops, fixed fetch URLs and
body/time bounds remain unchanged. No production migration or deployment performed.

Local verification for this expansion: TypeScript, ESLint, production build with
asset-manifest verification, offline build-asset regressions, and all 198 Vitest
files / 3,314 synthetic tests passed. The first
native D1 runtime run exited successfully across eleven sources. An additional
rerun printed all successful cases, including duplicate-migration rollback, but
its completion check was denied for an unexpected workers.cloudflare.com connection;
that run's process completion is unconfirmed and it was not retried or bypassed.
No production/provider availability is inferred from these synthetic checks.
