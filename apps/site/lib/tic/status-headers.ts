import type {TicStatus} from './cache';
/** Metadata is also sent on 304/503 so clients never shorten a source pause. */
export function statusHeaders(status: TicStatus, now = Date.now()): Record<string,string> {
 const headers: Record<string,string> = {};
 if (status.source_status) headers['X-Source-Status'] = status.source_status;
 if (status.next_retry_at) {
  const deadline = Date.parse(status.next_retry_at);
  if (Number.isFinite(deadline)) {
   headers['X-Next-Retry-At'] = status.next_retry_at;
   if (deadline > now) headers['Retry-After'] = String(Math.ceil((deadline - now) / 1000));
  }
 }
 return headers;
}
