# Continuous integration

`.github/workflows/ci.yml` runs on pull requests targeting `main` and pushes
to `main`. It reports three independent checks:

- **Site:** existing synthetic Vitest tests, ESLint, TypeScript, the offline
  build-asset regression scripts, and the production build including its
  postbuild asset-integrity check.
- **Web:** existing synthetic Vitest tests and the build, which also runs
  TypeScript.
- **Python:** synthetic core/API tests and the dependency-free AKShare
  normalization tests. The `test` extra declares the HTTPX dependency required
  by FastAPI's in-process TestClient.

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
is not a separate CI target. Native workerd/D1 runtime and browser acceptance
checks remain separate release checks, rather than being silently presented
as covered by these unit/build jobs.

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

The workflow does not change branch protection. A successful local run is not
a successful GitHub Actions run; inspect the checks for the exact remote commit.

