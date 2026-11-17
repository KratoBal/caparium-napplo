// A relative 303 redirect. NextResponse.redirect needs an absolute URL built from req.url,
// which behind a proxy or a tailnet name can carry the server's own bind address instead
// of the host the browser used; a relative Location always stays on the browser's host.
export function seeOther(location: string, setCookie?: string | string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
