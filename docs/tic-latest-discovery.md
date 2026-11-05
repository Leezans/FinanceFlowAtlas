# Hosted TIC latest-month discovery

The hosted `apps/site` country endpoint and historical chart now select the
latest observation month **present in the fetched official SLT Table 1**.
They do not infer a release from today's date, advance on a calendar schedule,
or claim real-time global flows. The separate Python manual CLI continues to
require an explicit month; its workflow is unchanged.

## Selection and validation

- One shared bounded UTF-8/TSV parser checks table identity, millions-of-dollars
  units, unique required columns, row lengths, month syntax and the closing
  definitions marker. The existing 10 MB and 12-second fetch limits remain.
- Discovery examines every row, not only valid totals. A newer country row with
  no matching Grand Total fails the refresh instead of quietly selecting an
  older month. The newest month must have exactly one correctly named/code-mapped,
  nonmissing, safe-integer equity transaction Grand Total. The country endpoint
  additionally requires valid mapped country observations and its existing
  duplicate/name/value checks. This does not establish exhaustive country coverage.
- Current and future UTC observation months are rejected. Transaction history
  begins in February 2023; no legacy Form S splicing occurs.
- History is twelve consecutive calendar months ending at the discovered month.
  Missing interior months remain null, including months before February 2023.
  Neither country sums nor nearby months replace missing observations.
- A valid newer month advances the endpoint. A later table whose latest month
  moves backward is rejected; the last-good snapshot remains explicitly stale.
  Same-month revisions are allowed and get a new raw hash/version.

## Dates, caching and deployment

`period` remains the observation month. `retrieved_at` is fetch time, not a
publication or revision time. Verified August 2026 release metadata is retained;
newer months without independently reviewed release metadata have null release
date/link. Source revision publication time remains null. Latest means latest in
that fetched table, not independently proven completeness across Treasury releases.
The country adapter is now `tic-equity-v1.1.0`; Python remains at its existing version.

The public source is checked on demand at most daily after success, with five-minute
failure backoff and a thirty-second database lease. There is no new background
scheduler. Check freshness and monthly publication lag are different concepts.
The country and history endpoints still have independent caches and may briefly
show different observation months around release time; their visible periods and
retrieval timestamps remain separate.

New cache keys distinguish automatic discovery from the old fixed-window policy.
On first use, a valid previous snapshot is copied to the new key with a
**discovery-pending stale warning**, no copied lease, and an immediately due source
check. A failed first check therefore preserves prior validated values. Concurrent
migration is insert-if-absent and cannot overwrite a successful refresh.

## Verification on 2026-11-05

A new direct read of the free official source returned 972,020 bytes, SHA-256
`dbdb9fb062d5f435aa625fd225bd42288029df46be33e84759c4741961e91180`.
Automatic discovery selected **2026-08**, with 77 country observations and a
published Grand Total of USD 153,942,000,000. The rolling chart returned all 12
months from 2025-09 through 2026-08; its August total matched the country endpoint.
No fetched observation file is committed.

August was still the latest source month at this check, not an erroneous stale
month. Treasury's [October 16 release](https://home.treasury.gov/news/press-releases/sb0662/)
scheduled the September data release for November 18. This code removes the fixed
August limit so a future published month can advance without another code edit.

Tests cover unsorted/month and year rollovers, no clock-only advancement, unknown
release dates, partial/invalid/future source months, signed values, missing history,
cache rollback/recovery, schema drift, dynamic UI captions, and actual SQLite
migration/lease publication. Live source verification is separate from synthetic
unit tests. Existing provenance, resident-attribution caveats, equity/fund-share
scope, integer USD conversion and non-real-time labels remain in place.
