import {statusHeaders} from './status-headers';
import {getCachedSource} from './cache';
import {repository} from './d1';
import {sha256} from './adapter';
import {historySchema, normalizeHistory, HISTORY_CACHE_KEY, type TicHistory} from './history';
export async function serveTicHistory(request: Request) {
 try {
  const {snapshot, status} = await getCachedSource(repository<TicHistory>(HISTORY_CACHE_KEY),
   value => historySchema.parse(value), normalizeHistory);
  if (!snapshot) return Response.json({detail: 'No validated TIC historical totals are available.', ...status},
   {status: 503, headers: {'Cache-Control': 'no-store', ...statusHeaders(status)}});
  const etag = '"' + (await sha256(snapshot.version + ':' + snapshot.retrieved_at + ':' + status.state)).slice(0, 32) + '"';
  const headers: Record<string, string> = {...statusHeaders(status),'ETag': etag, 'Cache-Control': 'no-cache', 'X-Data-Status': status.state};
  if (status.state === 'stale') headers.Warning = '110 - "Last validated TIC history; source check is stale or failed"';
  if (request.headers.get('If-None-Match') === etag) return new Response(null, {status: 304, headers});
  return Response.json(snapshot, {headers});
 } catch {
  return Response.json({detail: 'TIC historical cache is unavailable.', source_status: 'coordination_unavailable', next_retry_at: null}, {status: 503, headers: {'Cache-Control': 'no-store', 'X-Source-Status': 'coordination_unavailable'}});
 }
}
