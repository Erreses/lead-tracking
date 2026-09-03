import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  accessPassword,
  passwordMatches,
  verifySessionToken,
} from "@/lib/auth";
import { absoluteUrl } from "@/lib/http";

/**
 * The gate in front of everything.
 *
 * Runs on every request that isn't a static asset. Three ways through:
 * a valid session cookie (the browser, after logging in), a matching
 * `x-api-key` header (curl, scripts), or an unset password in development.
 *
 * In Next 16 Proxy runs on the Node.js runtime by default, so
 * `process.env.APP_ACCESS_PASSWORD` is read at request time. That matters:
 * Coolify injects it into the container, and a build-time-inlined value would
 * have frozen whatever was set when the image was built.
 */
export async function proxy(request: NextRequest) {
  const secret = accessPassword();
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!secret) {
    // Development convenience: `npm run dev` shouldn't demand a login.
    if (process.env.NODE_ENV !== "production") return NextResponse.next();

    // Production without a password would mean an open lead database on a
    // public URL. Fail closed, and say why — a blank 403 here would send you
    // hunting through container logs.
    return new NextResponse(
      "APP_ACCESS_PASSWORD is not set on this deployment, so the app is refusing to serve. Set it in Coolify's environment variables and redeploy.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // The login page and the handler its form posts to must stay reachable, and
  // so must the health probe — Docker has no password to present, and a gated
  // healthcheck would report every container unhealthy forever.
  // Signing out is allowed even without a valid session: an expired cookie
  // otherwise turns the Sign out button into a 401, and clearing a cookie
  // reveals nothing.
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/api/logout" ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  // Header auth, for anything that isn't a browser. Checked before the cookie
  // because a script has no cookie jar to fall back on.
  const headerKey = request.headers.get("x-api-key");
  if (headerKey && passwordMatches(headerKey)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, secret)) {
    return NextResponse.next();
  }

  // An API call gets a status code it can act on. Redirecting fetch() to an
  // HTML login page would surface as a JSON parse error somewhere unrelated.
  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Come back to where you were headed once you're in.
  const query = new URLSearchParams();
  if (pathname !== "/") query.set("next", `${pathname}${search}`);

  // Absolute, built from the forwarded host: the production server rejects a
  // relative Location here outright (ERR_INVALID_URL), and its own idea of the
  // origin is the container's `0.0.0.0:3000`.
  const path = query.size > 0 ? `/login?${query}` : "/login";
  return NextResponse.redirect(absoluteUrl(request, path));
}

export const config = {
  matcher: [
    // Everything except Next's own static output and the favicon. API routes are
    // deliberately included — they are the part worth protecting most.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
