# Independent A-share renderer proof

This directory is separate from the deployed atlas. It contains no route, fetch, provider client, credentials, subscription, scheduled task, or production dataset.

- `components/ashare/model.ts`: strict snapshot contract, trusted-marker gates, consistency validation, unit conversion, metric availability and coverage selection.
- `components/ashare/AShareTree.tsx`: provider-independent, explicitly single-level React industry→stock treemap receiving a validated snapshot or null. Any non-null industry parent_id is rejected; nested provider classifications must be reduced to one verified exclusive level upstream.
- `components/ashare/styles.css`: scoped dark treemap styles.
- `SOURCE_CONTRACT.md`: source contract and remaining approval boundaries.
- `tests/`: synthetic-only validation and interaction fixtures.

From this package directory, install the declared dependencies, then run `npm test` and `npm run typecheck`. Validation passed in the existing development dependency environment (23 tests and TypeScript). A fresh dependency installation and reproducible lockfile have not yet been verified; this package was not deployed or attached to an application route.

Original renderer source is covered by the repository Apache-2.0 license. Dependencies retain their respective licenses; no provider data or third-party source implementation is bundled.

Use the validator in a trusted adapter boundary; pass an explicit `now` for deterministic tests/SSR and update it through the owning application when freshness should be re-evaluated. Rights markers and optional expected hash are evidence inputs from that boundary, not a legal grant or independently verified provenance. No real source has been approved by this component.
