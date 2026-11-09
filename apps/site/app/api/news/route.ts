import { loadNewsSnapshot } from '@/lib/news/host';
export const dynamic = 'force-dynamic';
/** Closed source list only. No URL/source query parameter is ever fetched. */
export async function GET() {
  const snapshot = await loadNewsSnapshot();
  return Response.json(snapshot, {
    status: snapshot.status === 'unavailable' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
