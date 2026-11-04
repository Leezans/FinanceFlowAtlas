# SEC fund-share flow snapshot service

Independent service for the SEC N-PORT B.6 parser. This is **not** a sector,
country, individual-stock or equity-only capital-flow API. There is no market
total or classification inferred from fund names. Existing IMF/TIC endpoints,
stores and contracts are unchanged.

## Scope and validation

The supported import path runs `source_sec_nport.normalize` on local source TSV
members, then validates the complete parsed contract before committing it.
Decimal USD values remain strings. Null gross values produce null net values,
not zero. Net flow must equal subscriptions excluding reinvestment minus
redemptions. Negative gross values remain flagged. Each unique series must have
exactly three monthly records from the same filing. Duplicate months, altered
arithmetic, invalid provenance fields and inconsistent report dates are rejected.

The importer trusts the operator to supply genuine SEC source files and the
actual retrieval timestamp. Hashes provide traceability and detect later payload
changes, not authentication of SEC origin. Use the existing SEC downloader and
its SEC URL/HTTP checks to acquire the members. Imported files and database
must stay outside Git. No production data is bundled.

SQLite `sec-nport.sqlite` holds content-addressed snapshots and a current pointer.
Publishing the pointer and successful check status is atomic. Regressing the
active report-month/vintage or retrieval time fails. A failed import leaves the
last good snapshot intact. Old snapshots remain stored but are not concatenated
or summed across overlapping vintages. Revalidation and hash checks run on read.

## Import and run

From repository root with project dependencies installed:

```sh
PYTHONPATH=packages/core/src python -m financeflow.sec_nport_service \
  --submission /path/outside/git/SUBMISSION.tsv \
  --fund /path/outside/git/FUND_REPORTED_INFO.tsv \
  --report-month 2026-06 --vintage 2026q3 \
  --retrieved-at '<actual timezone-aware source retrieval timestamp>' \
  --data-dir /path/outside/git/financeflow-data

FFA_DATA_DIR=/path/outside/git/financeflow-data PYTHONPATH=packages/core/src \
  uvicorn apps.api.sec_nport:app --host 127.0.0.1 --port 8001
```

`--retrieved-at` is when the source bytes were retrieved, not when a local import
was run. Each input member is bounded to 32 MB. No download occurs on a GET
request and no credentials are required by this service.

The combined app registers the same separate SEC router:

```python
from financeflow.sec_nport_service import router as sec_nport_router
app.include_router(sec_nport_router())
```

Both the standalone app and the main app expose these SEC routes. Registering them does not load production data or deploy an API.

## API

- `GET /api/v1/flows/sec-nport`: `{version, status,
  bulk_publication_frequency: "quarterly", snapshot}`. The snapshot retains source
  URL, source member SHA-256 hashes, report month, vintage, filing/report dates,
  excluded counts, decimal strings, nulls and explicit limitations.
- `GET /api/v1/flows/sec-nport/status`: local availability, last successful source
  retrieval or failed import time, report month, vintage and check failure flag.
- Without a validated snapshot, return HTTP 503. Never substitute synthetic data.
- A failed ingestion returns the last good snapshot with `status: stale` and a
  Warning header. Conditional GET ETags include this state, so the transition
  is not hidden behind HTTP 304.
- `available` means validated **local snapshot**, not evidence that it is the
  latest release. There is no scheduled polling or freshness assertion. Monthly
  observations arrive in delayed quarterly bulk publications. Filing date is
  not a verified publication date; observation publication date remains null.

## Verification

```sh
PYTHONPATH=packages/core/src python -m unittest discover -s tests -v
```

Tests use explicitly synthetic fixture files only. They cover empty states,
exact arithmetic and null preservation, rejection without overwrite, mutations
of already-created models, period/vintage regression, corrupted payloads,
content integrity, failed refresh and recovery, and HTTP cache transitions.
The standalone and combined APIs use the same reviewed service; this change does not deploy either or expose real data publicly.

## Explicit one-shot source refresh

`financeflow.sec_nport_refresh` joins the existing bounded range downloader,
normalizer and transactional store. It does not install a schedule or perform
network access on startup or API reads. Both vintage and report-month cohort
must be explicitly selected. A newer report month can contain fewer funds,
so advancing the month is not a coverage upgrade and is never automatic.

```sh
# Configure SEC_USER_AGENT only with a real project contact authorized for SEC.
# No contact is inferred from a user profile and no placeholder is transmitted.
PYTHONPATH=packages/core/src python -m financeflow.sec_nport_refresh \
  --download --vintage 2026q3 --report-month 2026-06 \
  --data-dir /path/outside/git/financeflow-data
```

Without explicit `--download` and configured `SEC_USER_AGENT`, it fails before
network access or database changes. No SEC account, API key, token or paid plan
is needed. The contact identity is not stored in the snapshot. Existing HTTP
request/byte/rate limits and fail-closed behavior apply, including no automatic
retries on access denials, no redirect following and no full-archive fallback.
Successful retrieval sets the actual retrieval time and source Last-Modified;
failed retrieval or validation keeps the last valid snapshot and marks it stale.
Local TSV import remains available without contacting SEC or providing identity.
This entrypoint is a bounded single refresh, not a claim of continuous ingestion
or current market coverage. No observations or databases belong in Git.
