/** Recover only known page links with a copied Markdown closing delimiter.
 * Keep the target fixed and local. Unknown pages, API routes, and writes must
 * retain their normal routing instead of being silently redirected.
 */
export function recoverPageLink(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return null;
  }

  const match = /^\/(markets|ashare)[)）]/u.exec(pathname);
  if (!match) return null;

  return new Response(null, {
    status: 307,
    headers: {
      Location: `/${match[1]}`,
      "Cache-Control": "no-store",
    },
  });
}
