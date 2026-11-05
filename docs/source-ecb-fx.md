# ECB daily FX reference layer

## Scope and source

- UI: `/forex`; read-only endpoint: `/api/v1/fx/reference`.
- Official daily XML: <https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml>.
- Method and timing: <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html>.
- Terms: <https://www.ecb.europa.eu/services/disclaimer/html/index.en.html>.

These are **exchange-rate references**, not capital flows, trade volumes,
positions, minute quotes or executable prices. ECB states that updates usually
occur around 16:00 CET on working days, except TARGET closing days. The central-bank
concertation normally occurs around 14:10 CET. XML supplies the reference date,
not the exact release timestamp; the app does not manufacture either timestamp.
ECB publishes these rates for information and strongly discourages transaction use.

The actual number of quoted currencies comes from the validated response, not a
hardcoded promise of global coverage. EUR is the base currency and its identity
rate of one is excluded from that count. Missing currencies remain missing.
The layer is separate from country/industry/stock evidence and never supplies
conversion factors for other-date or other-concept flow datasets.

## Retrieval and verification

A direct normal-network request on 2026-11-05 returned HTTP 200, `text/xml`,
reference date 2026-11-04 and 29 quoted currencies. The source description and
usage terms were also read successfully. This is evidence for that retrieval,
not a guarantee of continuous availability in another deployment.
No downloaded rates or page captures are checked into Git.

Only the fixed official HTTPS endpoint is requested, without credentials.
Requests time out after 12 seconds, redirects are not followed, and response
bodies are bounded to 128 KiB even without a Content-Length header. Namespace-aware
XML parsing rejects DTDs, unexpected processing instructions, structural changes,
truncation, duplicate dates/currencies, invalid/zero/negative/non-finite rates,
future reference dates and empty datasets. The original decimal representation is
preserved for the source table. A same-day revision is accepted; a date regression
cannot overwrite a newer validated snapshot.

HTTP redirects, 401/403/407/429 and HTML responses clear the in-memory snapshot
and stop automatic acquisition for that service process. There are no alternate
hosts, authenticated routes, bypasses, retry overrides or reset controls. The latch
is **not durable across process restarts**; deployment operators must investigate a
source stop rather than restart to evade it. The page also clears data and stops
checks if its own access returns 401/403. This change does not alter site access
control, publish an existing private deployment, or establish new account access.

## Cache, dates and failure behavior

- Success is checked again after one hour; concurrent requests share one fetch.
- A transient or malformed-source failure retains only an already validated
  snapshot, with its original acquisition time and an explicit stale state.
- Failure imposes a 15-minute source cooldown. No first snapshot means HTTP 503,
  not zero values or sample data. Stopped acquisition clears data.
- State is memory-only, per process/isolate. Separate isolates do not share the
  rate limit or denial latch. No D1 migration, persistent credentials, account
  information, browser storage or raw-data files are added.
- The API uses `Cache-Control: private, no-store`. The UI polls hourly and does not
  bypass source cooldown via its manual check button. Browser connection failures
  are marked separately; invalid successful payloads clear the display.
- Reference date, acquisition time and last check time are distinct. Calendar-day
  age uses Europe/Berlin. A date more than seven days old receives a conservative
  warning, not a claim about an implemented TARGET calendar or measured latency.
  A check older than one hour is also visibly marked.

## Calculated cross-rates and rights

For the same reference date, `to_per_EUR / from_per_EUR * quantity` is a **derived
cross-rate conversion**, explicitly labelled as such. Display rounding uses up to
eight significant digits. It excludes spreads and fees and is not an ECB-issued
cross-rate quotation. The main table retains ECB source decimal precision. Invalid
amounts and unsupported currencies do not become zero or executable prices.

ECB's website conditions permit free use of its directly supplied information,
subject to accurate reproduction and attribution. Users must disclose modifications;
paid distribution has additional notice requirements that the source is available
free. Exceptions apply to named-author documents. The UI links the official source,
raw XML and terms, identifies calculations and preserves the information-only
warning. Repository Apache-2.0 licensing does not relicense ECB content or branding.
This layer is intended for the existing private research view; the change does not
expand access or claim permission for every future redistribution scenario.

## Reproducible checks

From `apps/site`:

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run test:fx-runtime
```

Tests use synthetic rates only. Native-workerd checks disable real networking and
exercise the actual route with plain/gzip/Brotli synthetic XML, malformed source,
access denial and cached responses. UI tests cover filtering, cross-rate direction,
swap, invalid amounts, stale preservation/recovery, schema rejection, access
clearing, interrupted navigation and repeated clicks. Source availability remains
a separate live check, not something inferred from passing mock tests.

The implementation was also checked against the actual downloaded XML above:
namespace parsing and schema validation accepted its 29 quotes and reference
date. Local Chromium visual QA could not run because the environment denied its
process singleton socket, including the permitted escalated attempt. Desktop and
mobile screenshots therefore remain unverified; automated component interaction
coverage must not be presented as visual inspection or production validation.
