# Continuous integration

`.github/workflows/ci.yml` runs on pull requests targeting `main` and pushes
to `main`. It reports four independent checks:

- **Site:** existing synthetic Vitest tests, ESLint, TypeScript, the offline
  build-asset regression scripts, and the production build including its
  postbuild asset-integrity check.
- **Web:** existing synthetic Vitest tests and the build, which also runs
  TypeScript.
- **Python:** synthetic core/API tests and the dependency-free AKShare
  normalization tests. The `test` extra declares the HTTPX dependency required
  by FastAPI's in-process TestClient.
- **Native workerd/D1:** five existing offline suites exercise A-share gate
  contention/backoff and atomic snapshot rollback, TIC cross-worker denials and
  Retry-After, and Deribit atomic publication, uncertain acknowledgments and
  preservation of other tables during migration. Diagnostics applies the full
  migration sequence in filename order and verifies read-only queries preserve
  the database. They use ephemeral local databases and synthetic
  responses, with every worker fetch intercepted by a network-disabled mock or
  a fixed synthetic outbound service. No remote D1 account is used.

## Boundaries

Jobs use disposable GitHub-hosted Ubuntu runners, Node 24 and Python 3.12.
The Site job is capped at 15 minutes and the smaller jobs at 5 minutes.
New commits cancel older runs for the same branch or pull request; Vitest
uses at most two workers.

Only official GitHub actions are used, pinned to full commit SHAs. The
workflow requests read-only repository access, does not persist checkout
credentials, uses no secrets, and has no deployment, artifact upload,
scheduled trigger, or `pull_request_target` trigger. Dependency caches are
disabled. Dependency installation uses the committed npm lockfiles and
`--ignore-scripts`; the explicitly invoked tests and builds still run project
code. Do not change these jobs to use a self-hosted runner.

Python's direct runtime and test dependencies are pinned in `pyproject.toml`.
There is not yet a complete Python transitive-dependency lockfile, so Python
installation is not fully reproducible in the same way as the npm installs.

These checks use synthetic fixtures and mocked transports, not live financial
sources. They do not launch collectors, refresh source data, invoke the
scheduler, connect to a hosted D1 database, or deploy anything. The optional
AKShare provider dependency is not installed. Dependency downloads still need
network access. This workflow is not an egress sandbox and does not establish
provider availability or production readiness.

The standalone `packages/ashare-renderer` package currently has no lockfile and
is not a separate CI target. Native coverage is limited to the five named
suites, not every provider or runtime scenario. Browser acceptance and the
remaining native suites remain separate release checks. Migration assertions
in the existing Deribit suite intentionally fail when the expected migration
set changes; review and update them alongside new migrations. The diagnostics
suite checks the current fresh schema, not every historical upgrade path.

## Run the same checks locally

Use a clean checkout and the same runtime majors. From the repository root:

```sh
python -m pip install ".[test]"
python -m unittest discover -s tests -v
PYTHONPATH=packages/akshare-adapter/src python -m unittest discover -s packages/akshare-adapter/tests -v

cd apps/web
npm ci --ignore-scripts --include=dev --include=optional --no-audit --no-fund
npm test -- --maxWorkers=2 --minWorkers=1
npm run build

cd ../site
npm ci --ignore-scripts --include=dev --include=optional --no-audit --no-fund
npm test -- --maxWorkers=2 --minWorkers=1
npm run lint
node node_modules/typescript/bin/tsc --noEmit
npm run test:build-assets
npm run build
```

The native job runs separately from the unit/build job. From `apps/site`, after
the same locked install:

```sh
npm run test:diagnostics-runtime
npm run test:ashare-backoff-runtime
npm run test:ashare-snapshots-runtime
npm run test:tic-runtime
npm run test:deribit-runtime
```

Do not replace the test transports with live fetches, add secrets, persist the
fixture databases, or run these scripts against production. There are no
automatic test retries; an uncertain or failed result must stay visible.

The workflow does not change branch protection. A successful local run is not
a successful GitHub Actions run; inspect the checks for the exact remote commit.

