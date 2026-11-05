# A-share source transport

The hosted `/ashare` view retrieves public Eastmoney industry and constituent
order-flow fields through bounded Cloudflare Workers native fetch. It needs no
Tushare account, source login, user identity, or API key. The source fields are
provider order-classified estimates, not market-wide newly created money.

## Native content decoding

Cloudflare's [Fetch documentation](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
describes automatic gzip/Brotli negotiation and decoding when the response body
is read. `Content-Encoding` can remain present on the decoded response. The
adapter therefore accepts an absent/identity, single gzip, or single br coding
and reads the native decoded stream. It does not decode the body a second time.
Unknown or chained encodings remain unsupported.

The four-megabyte acquisition budget counts **decoded** bytes across all pages
and the permitted official redirect, including responses with a smaller encoded
Content-Length. A declared length larger than the remaining budget is also
rejected. The existing request deadline, page/row limits, exact-target redirect
validation, unique IDs, stable totals, complete pagination, strict numeric
validation, and duplicate-key JSON rejection remain in force.

No new source host, proxy, account, retry route, or access method is introduced.
HTTP denials, challenges, and off-policy redirects still stop source acquisition
persistently. No denial gate is cleared by this change. Source payloads remain
ephemeral; the database stores only acquisition metadata.

## Diagnostics and verification

Failed acquisitions emit only an allowlisted `error_code` and scope kind in
production logs. The error API and client use bounded local explanations rather
than exposing provider bodies, exception strings, URLs, or credentials. This
allows a missing migration, busy coordination, unsupported encoding, malformed
source data, timeout, and source denial to be distinguished without loosening
validation or manufacturing a fallback snapshot.

Synthetic tests cover runtime-decoded gzip/br responses, the decoded byte limit
with a small encoded length, unsupported/chained encodings, and raw compressed
bytes that were not decoded by the runtime. These tests establish adapter
behavior, not live availability. A successful real production snapshot and
constituent drilldown must still be observed through the authenticated private
Site before claiming that the production source is working.
