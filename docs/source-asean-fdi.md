# ASEANstats annual country × economic-sector inward FDI matrix

## Source and reuse decision

The official public indicator `FDI.HOS.X.SECT` is “Flows of Inward Foreign Direct
Investment (FDI) by AMS and Economic Sectors (in million US$)”. The public page
`https://data.aseanstats.org/fdi-by-ams-economic-sectors-inward` uses ordinary
anonymous form POST requests to `https://data.aseanstats.org/api/trade`, confirmed
by its own `user/js/fdis.js?n=1.1.1.17` and a successful unauthenticated response
on 2026-11-05. No cookies, credentials, API key, registration or signed-in session
are used. The separate `api.aseanstats.org` service requires approved accounts
and is deliberately not used or treated as an alternative route.

The official terms at `https://www.aseanstats.org/terms-and-conditions-of-use/`
explicitly cover both the www and data portals. They permit quotation, download,
copying and reproduction with ASEANstats credit and corresponding technical
notes. They require that alterations/derivative works not be attributed to
ASEANstats. The full terms inspected did not state a commercial-use or
indicator-specific exclusion. This is not a Creative Commons or standard
open-source data license, and the repository software license does not replace
it. Website use is subject to the terms, which also disclaim accuracy/timeliness
and contain an indemnity condition.

The terms additionally require prior permission for website hyperlinks/framing.
The app therefore supplies **plain-text source attribution**, never an external
ASEANstats anchor or frame. References in this document are code text, not links.
No permission request was sent, no account created and no legal checkbox accepted.

Both the Chinese technical explanation and the original English portal notes
are preserved in `components/asean/SourceNotes.tsx`, including preliminary status,
source n.a meaning, unallocated activities and Philippines/Singapore caveats.
The UI separately attributes its translation, validation and visualization to this
application, not to ASEANstats. No provider observations are committed to Git;
tests use explicitly synthetic observations.

## Metric and dimensions

This is genuine **annual net inward direct investment**, in **million US dollars**,
not securities trading, fund subscriptions/redemptions, asset positions, a price
proxy, or daily/live market flow. Inward FDI is investment-increasing transactions
less investment-decreasing transactions by foreign direct investors into resident
enterprises. It contains equity, reinvested earnings and intercompany debt. It is
not inward FDI minus outward FDI. Negative values remain negative.

The verified portal query contract is fixed to:

- `Reporter`: BN, KH, ID, LA, MY, MM, PH, SG, TH, TL, VN.
- `Partner`: economic sectors A through S plus Z, **not origin countries** here.
- `Year`: 2017 through 2025 inclusive.
- `Frequency=A`, `Period=00`, `Flow=F`, `Commodity=1`, `Unit=114`.

The raw envelope is `{CsvUrl:"", Trade:[...], RowLimit:null, RowCount:null}`.
Each row has `Reporter_Code`, `Reporter`, numeric `Year`, `Code`, `ActivityLong`
and string `Value`. All expected names/codes and the exact shape are checked.
The public page generates its spreadsheet export client-side; no stable CSV
export URL, pagination contract or unobserved API flags are invented. Unexpected
fields, dimensions, row limits or values reject the candidate rather than silently
publish a subset. Source schema drift requires a reviewed adapter update.

## Source quality and comparability

The full response independently supplied by the verifier was parsed successfully:

- 1,993 source rows into 1,980 expected country × sector × year coordinates.
- 1,045 unique numeric cells, 922 unique `n.a` cells, 13 duplicate-key cells.
- 2025: 115 numeric cells, 101 unique `n.a` cells, 4 duplicate-key cells (220 total).

These are observed validation counts, not a completeness guarantee or a fresh
production-host access claim. Numeric+n.a and conflicting numeric duplicates
exist. Every duplicated key is quarantined, including identical duplicates;
original values are retained for inspection. No first/last choice or summation.

`n.a` conflates suppressed/confidential, nil and negligible. It is not converted
to zero, and unavailable coordinates have a separate missing state. Exact reported
numeric zero remains zero. Unspecified activity Z includes confidential values.
No residual reconstruction or inference of suppressed observations is performed.

Philippines sector breakdown is limited to net equity capital; debt investments
and reinvested earnings are placed in Z. Singapore M includes N. Therefore
matching letter codes do not establish full country-by-country comparability.
The app makes no harmonized national/industry totals and no source-country ×
host-country × sector tensor claim. TL's appearance is a portal dimension, not a
claim about historical membership or universal data availability.

## UI and time semantics

`/asean` is an actual two-axis heatmap: 20 economic-sector rows × 11 host-country
columns, with a year and optional country filter. All expected coordinates remain
visible, not top-N. Equal-size cells never imply investment size. Signed color
strength uses a common linear absolute-million-USD scale for the full selected
year; filtering a country does not rebase it. Zero is neutral, unknown is gray,
duplicate cells are striped. Country/sector identity, original unrounded values
and quality notes are available by keyboard/click. Year/country selection survives
refresh. The matrix scrolls horizontally on small screens with persistent row
labels. Empty sources show no numeric cells.

The page observed an update of 1 July 2026 and says the data are preliminary as of
that date. Those facts are explicitly dated as a **2026-11-05 metadata check**, not
represented as API-provided release timestamps. Actual source release time is
unknown. Acquisition start/fetched times are separate UTC instants. Historical
annual observations are not expired merely because their year is old. The fixed
2017–2025 selection is not advertised as automatic future-year discovery.

## Acquisition, cache and denial handling

One fixed same-source anonymous form POST is admitted at most once per day by an
independent D1 gate. The request uses manual redirects, credentials omitted,
strict JSON with duplicate-key rejection, a 4 MB decoded-body limit, a 25-second
acquisition deadline and retained request-lifetime admission/settlement. No
request-controlled upstream URL or dimension parameters are accepted.

Access denial, rate-limit, redirect and HTML challenges permanently block this
source gate and clear the shared report; other provider gates are untouched.
There is no alternate-route fallback, automatic unblock or busy-lease takeover.
Temporary errors retain only valid last-good data and honor longer Retry-After.
Cache expires after seven days in both browser and server; failures cannot renew
its age. Busy/unavailable coordination never starts concurrent collection, and
uncertain writes fail closed.

`0008_asean_fdi_gate.sql` is appended after the canonical TPEx 0007 migration,
with an independent source table and initial row. Generated snapshot metadata
retains all prior tables. World Bank PR11 remains held and must use a later index;
CVM reserves 0009. No existing gate row is altered.

## Verification

- Strict parser validated the actual anonymous response (not committed).
- 44 focused unit/component tests cover quality, duplicate quarantine, zeros,
  coordinates, labels, year/country interaction, raw values, refresh, expiry,
  denial and source acquisition safeguards.
- Native workerd/D1 runtime test: plain/gzip/Brotli; warm/cold shared cache and
  daily cooldown; all existing gate states unchanged; two-day Retry-After; denial
  clears warm and shared cache; request abort still settles the exact owned lease.
  All external network is disabled and observations are synthetic in this test.
- Final integrated app suite: 722 tests in 48 files passed; ESLint, TypeScript no-emit and
  production build passed.
- Integration browser QA passed against synthetic local fixtures on desktop and
  320/375px responsive layouts: all 220 cells, repeated detail close/selection,
  year/country filters, duplicate raw values and missing/denied states. Single-
  country views fit the viewport; the industry header stays visible while the
  full matrix scrolls. Tiny nonzero values use scientific notation rather than
  displaying zero. No synthetic preview route or fixture data is deployed.
- No deployment or production-host acquisition is implied by local verification.
