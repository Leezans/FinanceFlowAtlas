# Polymarket keyset contract evidence

Checked official documentation on 2026-11-05. No provider-data requests were used for this research.

Source: https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination

Relevant contract excerpts:
- “Maximum number of results to return (max 100)”
- “Opaque cursor token from a previous response's next_cursor”
- Offset: “Not allowed. Returns 422 if provided.”
- Response: “markets” is an array; “next_cursor” is a string.
- “Opaque cursor token for fetching the next page. Present only when the number of returned markets equals the effective limit. Omitted on the last page.”
- “keyset pagination is not configured” is the documented service-unavailable response.
- “When true, includes Tags relation on each market” describes include_tag.

The contract does not provide a total count or snapshot-isolation guarantee. The documented order parameter accepts JSON field names; ID ordering still requires verification through the normal gated production acquisition. closed=false is documented; active is not a documented keyset filter, so eligibility remains locally verified.

Source: https://docs.polymarket.com/api-reference/rate-limits

Gamma lists /markets at 300 requests per 10 seconds, general 4,000 per 10 seconds, and market/event listings combined at 900 per 10 seconds. Limits are IP-based, use sliding windows, and may delay/queue requests rather than immediately reject them. No separate keyset rate is specified. The app uses at most five requests per collection, with shared cooldown at least 30 seconds after release.

The eight-second page-start budget is inside the unchanged twelve-second acquisition deadline. Preflight inspection and exact-owner cleanup have their own bounded waits; this is not a twelve-second total HTTP response latency guarantee.
