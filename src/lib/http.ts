/**
 * Work out the address the browser actually used to reach us.
 *
 * Inside a container the server binds `0.0.0.0:3000`, and anything that builds
 * a redirect from the server's own view of the request sends the browser there
 * — an address that means "everywhere" to a listening socket and "nowhere" to a
 * browser. Coolify's proxy terminates TLS and forwards the real host in
 * `x-forwarded-*`, so that is what a redirect has to be built from.
 *
 * Falls back to `host` for direct connections (local development, the Docker
 * healthcheck), and finally to a relative URL if neither header is present.
 */
export function externalOrigin(request: Request): string | null {
  const headers = request.headers;

  // May be a comma-separated chain when several proxies are involved; the
  // first entry is the one the client actually addressed.
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host");
  if (!host) return null;

  // Only trust a forwarded protocol we recognise. Assume https whenever a proxy
  // is in front of us: getting this wrong would downgrade a Secure cookie's
  // redirect to plain HTTP.
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : forwardedHost
        ? "https"
        : "http";

  return `${proto}://${host}`;
}

/**
 * Absolute URL for a path on this app, as the browser would address it.
 *
 * `Response.redirect` requires an absolute URL and Next rewrites a relative
 * `Location` in a route handler back to the server's own origin, so there is no
 * way around resolving the host — only a choice about doing it deliberately.
 */
export function absoluteUrl(request: Request, path: string): string {
  const origin = externalOrigin(request);
  // `request.url` is the last resort and is wrong inside a container; reaching
  // it means neither a forwarded host nor a Host header was sent, which no real
  // browser does.
  return new URL(path, origin ?? request.url).toString();
}
