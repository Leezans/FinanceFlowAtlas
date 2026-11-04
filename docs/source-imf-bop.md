# IMF BOP portfolio equity transactions

## Integration

This increment adds the following files without replacing the existing IMF PIP, TIC or SEC implementations:

- `packages/core/src/financeflow/source_bop.py`
- `packages/core/src/financeflow/bop_service.py`
- `packages/contracts/bop-flows.schema.json`
- `tests/test_bop.py`
- `docs/source-imf-bop.md`

The combined `apps/api/main.py` registers this independent router alongside the preserved TIC and SEC routers:

```python
from financeflow.bop_service import router as bop_router
app.include_router(bop_router())
```

Existing dependencies (FastAPI, Pydantic, pycountry) suffice. Test with the repository's Python environment:

```sh
PYTHONPATH=packages/core/src python -m unittest discover -s tests -p test_bop.py -v
PYTHONPATH=packages/core/src python -m financeflow.bop_service --period 2026-Q2 --indicator P_F51 --data-dir var
```

GET `/api/v1/flows/bop?period=2026-Q2&indicator=P_F51` returns the snapshot. GET `/api/v1/flows/bop/status` accepts the same query. `period` is required; `indicator` defaults to equity only. No GET performs ingestion or outbound network requests. The CLI refuses every HTTP redirect, requires status 200 and the exact requested official URL, limits responses to 20 MB and a 90-second socket inactivity timeout (not a total request deadline), and never retries 403/429. All storage is in `bop.sqlite`, separate from holdings and TIC. No UI changes are included. Do not use these rows for bilateral map edges.

## Source contract and evidence

Official [BOP dataset](https://data.imf.org/Datasets/BOP), [API resource](https://data.imf.org/en/Resource-Pages/IMF-API), and [full structure](https://api.imf.org/external/sdmx/2.1/dataflow/IMF.STA/BOP/latest?references=all).

Validated from the official structure and responses retrieved 2026-11-04:

- Dataflow `IMF.STA:BOP(21.0.0)`; structure `DSD_BOP(24.0.0)`.
- Dimension order: COUNTRY, BOP_ACCOUNTING_ENTRY, INDICATOR, UNIT, FREQUENCY.
- `P_F51`: Portfolio investment, Equity. Not listed-stock trading, direct investment, or reserve assets.
- `P_F5`: Portfolio investment, Equity and investment fund shares. Overlaps P_F51; never add the two.
- `A_NFA_T`: Assets, Net acquisition of financial assets. Positive means resident net acquisition abroad/outflow. Negative means net disposal/inflow.
- `L_NIL_T`: Liabilities, Net incurrence of liabilities. Positive means nonresident net investment in the reporting economy/inflow. Negative means net disinvestment/outflow.
- Preserve BPM6/BPM7 per fact; no cross-methodology net calculation is performed.
- Positive/negative meanings are explicit per fact. Source signs are never inverted or clamped. Exact decimals serialize as strings.
- A and Q are separate selections; do not sum annual and quarterly values. No bilateral counterpart dimension exists.
- Restrict to ISO 3166-1 reporting economies via the existing registry. Territories are included without sovereignty inference. Regional aggregates (G163/G309), composite CWX, and non-ISO codes are excluded, not relabeled as countries. Kosovo is not added silently.
- Require public access classification and normal observation status. Missing, flagged, or confidential values are not zero. Unknown unit, scale, methodology, duplicate observations, changed flow version, malformed or non-UTF-8 XML, DTD/entity declarations and non-finite numbers fail closed.

The existing official 2024–2026 response files were replayed locally, not committed. For **2026-Q2 only**, the actual accepted counts were:

| Selection | Reporting economies | Both directions | Facts |
| --- | ---: | ---: | ---: |
| P_F51 | 63 | 60 | 123 |
| P_F5 | 95 | 91 | 186 |

These count only eligible observations present in the received response, not every global reporter or synchronized country publication. These are snapshot counts, not all-history country coverage or a promise of current API availability. The source files' SHA-256 values are `155da4ec3bf518418adb8ee0decee0c31f536ec94f3fa167834b2bc72f9bc52d` (P_F51) and `516e97bdd256a9aafd7179e44645c8470d250b5598420a6fdb2ee60608f2ffa8` (P_F5). No new live download was performed by this implementation task.

Dataset publication time in those responses is `2026-11-03T15:10:15.118439400Z`; update time is `2026-11-03T15:10:17.172637900Z`. Response Prepared is request preparation, not release time. All are kept separate from retrieval time and observation period. Dataset publication is not a country-specific release date. Revision identity includes normalized fact content as well as raw hash, selected dimensions and unit evidence. Semantic model validation checks counts, scope, signs, ISO codes, uniqueness, unit evidence and monetary consistency on save and load; model_copy cannot bypass persistence validation. Decimal input length/exponents are bounded and conversion uses exact 256-digit local precision with fixed-point output. Revision comparison and publication hold a SQLite immediate write transaction to prevent concurrent older ingestion from overwriting newer data. Revision payloads are versioned; older retrieval/update metadata cannot overwrite current data for a given period/indicator. A failed refresh retains last-good data and marks stale. Retrieval older than 48 hours marks the **source check** stale, not the underlying annual/quarterly observations overdue.

## Monetary readiness: unresolved, explicitly gated

The official codelist describes SCALE=6 as millions (10^6), but the XML contains dollar-sized amounts: US P_F5 liability incurrence for 2024 is `307492000000`. The Federal Reserve's [BEA-sourced ALFRED series](https://alfred.stlouisfed.org/series?seid=IEAIPIEA) reports 2024 as 307,492 **million dollars**, corroborating a factor of 1 for that individual API observation. That check alone does **not** certify both indicators and all country series. US asset observations show small vintage/revision differences versus external tables. A blanket 10^6 multiplier would be materially wrong for the checked liability value.

Therefore default output preserves `source_value`, `source_unit`, and `source_scale`, sets `unit_status=review_required`, and leaves `value_usd=null`. Neither the UI nor a downstream consumer should label native values as USD-normalized, compute financial totals, or plot them as money while this gate is unresolved. No ranking or derived net-inflow total is supplied.

An operator may provide `--unit-evidence FILE.json` only after a reviewed reconciliation covering the entire selected response. The exact response hash and indicator must match. JSON fields: `raw_sha256`, `indicator`, `factor_to_usd` (`"1"` or `"1000000"`), `official_reference_url`, `reconciliation_note`. This is an attestation input, not automated proof; an official URL by itself is not a reconciliation. No production unit manifest is supplied. A new/changed raw response requires a new reconciliation. The adapter never infers conversion from magnitude. Synthetic test evidence is not usable for real payloads because of the hash binding.

## Scope and rights

No subscription key, paid provider, writes to IMF, transactions, public deployment, or raw dataset distribution. Official terms: https://www.imf.org/external/terms.htm. The connector is for the user's personal statistical research; this implementation does not certify public redistribution rights. Raw data and SQLite files belong outside source control. API responses use private cache control. Hosting/access control is the integrator's responsibility.

## Verification

Nine synthetic test groups cover sign preservation, zero, distinct broad scope, monetary gate and hash binding, invalid dimensions, confidentiality/status, missing and nonfinite values, aggregates, duplicate facts, query validation, isolated storage, read-only API, cache validation, stale failed-refresh retention, and revision regression. Existing official XML replay validates the structure/parser and selected-period counts above. The isolated implementation passed independent review; monetary unit reconciliation remains incomplete. Integrated regression verification passed 70 backend tests, including the existing SEC suite. Empty-state API smoke checks preserved separate BOP, SEC, TIC and PIP behavior.
