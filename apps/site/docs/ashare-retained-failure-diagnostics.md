# A-share retained failure metadata

The read-only diagnostics endpoint keeps `financeflow-diagnostics/1`. Its additive `retained_failure` object is optional at the presentation boundary so older responses still render unknown failure evidence.

Only the existing Eastmoney fixed SELECT reads `failure_code`, `last_failure_ms`, and `failure_count`. No source handlers, gates or stores are imported. No acquisition, initialization, reset, retry or migration is added.

The handler maps exact known machine codes to fixed categories. Unrecognized values become `unknown`; raw strings are never echoed. `recorded_at` is a canonical UTC timestamp only for a positive safe integer not after the database observation clock. `durable_streak_count` accepts only integers 0 through 5; malformed values stay null, not coerced or clamped. A zero or unknown count suppresses retained category/time.

The count is the existing durable failure streak capped at 5, not a lifetime total. The record belongs to the shared A-share gate across collection scopes, not specifically the level-one snapshot shown by the card. Idle, expired cooldown and a cleared streak do not prove source recovery or usable data. A retained failure does not override stopped/unknown coordination or reveal suppressed cache metadata. Other sources return unknown/null failure fields with `not_available` semantics.

Synthetic validation: `npx vitest run --config vitest.config.ts tests/diagnostics.test.ts tests/diagnostics-ui.test.tsx`. These suites use in-memory stubs and DOM fixtures, forbid provider fetches in the handler, and cover hostile D1 fields, bounded values, old responses, unreadable metadata, source scoping and honest UI labels. No production verification is implied.
