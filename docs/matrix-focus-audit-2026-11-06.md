# Matrix focus and zoom interaction audit

Reviewed against main `606c4a1afb234eb987974c9ab3db4a603284075b`, the
runtime-equivalent source of private Site v59, on 2026-11-06.

## Reproduced defect

The shared monetary matrix moved its viewport when an already visible tile was
clicked. In an offline Chrome fixture using the production React components and
synthetic amounts, clicking the largest tile at 150% zoom changed the transform
from `translate(-241 -130)` to `translate(0 0)`. A neighboring tile that had been
visible was pushed outside the viewport.

SVG pointer focus ran the same reveal operation intended for keyboard navigation.
The reveal helper also tried to expose both edges of an oversized tile, producing
unnecessary or alternating movement. This affects the shared monetary renderer;
it is not a financial-value, area-weighting or data-acquisition defect.

## Correction

- Reveal tiles on keyboard-visible focus, not on mouse or touch focus. Selection
  and numeric inspection still work after pointer focus.
- Keep oversized keyboard-focused tiles steady when they already cover the
  viewport, otherwise reveal the nearest edge. Small offscreen tiles still become
  fully visible within the bounded transform.
- Preserve a visible inset viewport outline while a tile has keyboard focus,
  including when its own outline is outside the clipped viewport.

No amount, currency, color, source adapter, source gate, cache, request cadence,
permission, database schema or acquisition path changed. No new buttons were
added; missing and nonmonetary views still omit monetary zoom controls.

## Verification

- Four new regression cases cover pointer versus keyboard focus, stable oversized
  focus, and nearest-edge/idempotent reveal. Removing the new focus guard makes
  the smaller-tile pointer regression fail, independently of the geometry fix.
- Focused viewport suites: 17 tests passed.
- Full hosted suite: 121 files / 1,940 tests passed. TypeScript, warning-free ESLint,
  production build, client-asset verification and build-asset regression checks
  passed.
- Real Chrome, offline synthetic data: pointer click preserves the transform;
  drag pans without selecting; wheel zoom works; Tab reveals the next tile;
  Enter selects; same-scope refresh preserves zoom; scope changes reset zoom.
- At 225% zoom, keyboard focus on an oversized tile preserves its transform and
  has a visible 2px inset viewport outline.
- A 360px document viewport has no horizontal document overflow; zoom/reset work;
  default touch-action remains `pan-y pinch-zoom`. All zero/missing rows remain
  accessible without invented area. Information-card and empty states have no
  monetary zoom controls.

The browser fixture used shared components and synthetic data, not the complete
production app or real financial observations. The narrow-document check is not
physical-phone testing. Native touch pinch/cancellation and zoom-bound behavior
remain covered by synthetic event tests. No production page, authentication flow,
provider endpoint, migration, cache reset or gate mutation was used for QA.
