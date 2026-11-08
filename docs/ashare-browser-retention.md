# A-share browser retention

The browser may retain a validated same-scope snapshot after a temporary application or network failure, but never beyond 24 hours from the oldest retained acquisition clock. `collection_started_at` is used when present; older payloads fall back to `fetched_at`. Revalidation, HTTP 304, retries, and UI activity never move that deadline.

## Responsibilities

- `lib/ashare/retention.ts` computes the shared inclusive expiry boundary. Organized exports use the same deadline as the client and workspace.
- `components/ashare/client.ts` removes the snapshot and ETag before an outgoing request, on state reads, and after responses or network failures. Expiry preserves recovery and scheduling metadata. A 304 without retained bytes still preserves its recovery headers.
- `AshareWorkspace` schedules a local expiry timer and checks again on focus, page restore, and visibility changes. That effect only evicts local bytes. It does not request data, clear the request generation, reset cooldowns, or reopen a stopped source.
- In-flight completions use the current client state rather than a captured prior snapshot. A late 304/error cannot resurrect evicted bytes; a validated fresh 200 may replace them.
- Organized downloads retain their existing click-time validation, including checks for permission, scope, expiry, and clocks ahead of the browser.

The ordinary source polling and bounded collection loop remain the sole request scheduler. Expiry is independent of that scheduler, so a long cooldown or suspended polling cannot keep a heatmap indefinitely. None of these changes alter provider access, source gates, server stores, or consent.

## Regression coverage

`ashare-retention.test.ts` covers the exact oldest-clock boundary, 200/304/503, network rejection, long cooldowns, stops, ETag removal, and late responses. `ashare-retention-ui.test.tsx` exercises mounted heatmaps, local deadlines, suspended-tab events, cooldowns, and fresh late responses. Historical recovery and scheduling fixtures now use an eligible acquisition clock rather than relying on unlimited browser retention.
