# FinanceFlowAtlas

Global equity evidence atlas. This v0.2 monorepo separates Python data processing/API from a React TypeScript frontend. It covers a **global 249-country/territory registry**, not complete data for every country. Initial source is IMF PIP bilateral equity **positions**, not real-time fund flows.

## Run locally
Python 3.11+, Node 20+ recommended.

```sh
python -m venv .venv
. .venv/bin/activate
pip install -e .
python -m unittest discover -s tests -v
# Fetch a verified period only after independently reviewing unit semantics:
python apps/cli/main.py --period 2025-S2 --unit-verified
uvicorn apps.api.main:app --host 127.0.0.1 --port 8000
# Separate terminal:
cd apps/web && npm ci && npm run dev
```

`--unit-verified` is an explicit operator attestation, not automatic proof. Without it ingestion refuses to publish monetary values. Do not apply it to an unknown provider schema.

For source refresh, run `python apps/worker/main.py --period 2025-S2 --unit-verified --loop`. The UI polls the stored API snapshot every minute; the source worker rechecks this low-frequency source daily for revisions. A newer observation period must currently be selected explicitly. No background service or schedule is enabled by merely installing the project.

Environment: `FFA_DATA_DIR` selects API data directory (default `var`). CLI/worker use `--data-dir` (same path). `VITE_API_BASE` selects frontend API origin. One-origin deployment is preferred; only localhost development CORS origins are allowed by default.

## Repository
- apps/web — React/TypeScript world map and evidence UI
- apps/api — FastAPI query endpoints
- apps/worker, apps/cli — source refresh entrypoints
- packages/core — source adapter, contracts, registry, validation and persistence
- packages/contracts — exported machine-readable schemas
- tests — synthetic unit/API tests, no captured financial data
- docs — architecture, source semantics and verification
- legacy — previous single-Worker prototype, not the v0.2 runtime

Raw CSVs, databases, snapshots, credentials and vendor observations stay outside Git. Source license does not grant provider-data redistribution rights. Review IMF, geographic-data and dependency licenses before your chosen deployment.

## Limits
No comprehensive real-time global flows, FX/futures layer, automatic trade execution or profit claims. Half-yearly positions cannot prove where money is moving today. ISO registry coverage, actual source reporters/counterparties and polygon availability are different counts. The app must retain unknown/missing/confidential states rather than replace them with zero. See docs/architecture.md.
