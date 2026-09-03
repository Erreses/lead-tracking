import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  accessPassword,
  createSessionToken,
  passwordMatches,
  sessionCookieOptions,
} from "@/lib/auth";
import { absoluteUrl } from "@/lib/http";
import { logger } from "@/lib/log";

const log = logger("auth");

/**
 * Sign-in for a plain HTML form — no client JavaScript involved.
 *
 * A route handler rather than a Server Action, for two reasons. Server Actions
 * are CSRF-checked against the request origin, which behind a reverse proxy
 * needs `serverActions.allowedOrigins` kept in step with whatever domain
 * Coolify hands out; and their redirect resolves against the server's own
 * address, which inside the container is `0.0.0.0:3000`. Here the Location is
 * built explicitly from the forwarded host, so it is testable and there is no
 * hidden origin check to misconfigure.
 */

/**
 * Only ever redirect to a path on this app.
 *
 * `next` arrives from the form, so it is attacker-controllable: a link to
 * /login?next=https://evil.example would otherwise turn our own login page into
 * a credible-looking redirect off-site. Leading `//` is rejected too, since
 * browsers read `//host` as protocol-relative and go off-site.
 */
function safeNext(value: FormDataEntryValue | null | undefined): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function POST(request: Request) {
  const secret = accessPassword();
  const form = await request.formData().catch(() => null);
  const next = safeNext(form?.get("next"));

  // 303 so the browser follows with GET; a 307 would replay the POST, and the
  // password would be re-sent on every refresh of the page it lands on.
  const seeOther = (path: string) =>
    NextResponse.redirect(absoluteUrl(request, path), 303);

  // No password configured means the proxy isn't gating anything; there is
  // nothing to sign in to.
  if (!secret) return seeOther(next);

  const submitted = form?.get("password");
  if (typeof submitted !== "string" || !passwordMatches(submitted)) {
    // Deliberately not logging the attempted value.
    log.warn("login.rejected", { path: next });

    const query = new URLSearchParams({ error: "1" });
    if (next !== "/") query.set("next", next);
    return seeOther(`/login?${query}`);
  }

  const response = seeOther(next);
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionToken(secret),
    sessionCookieOptions(),
  );

  log.info("login.accepted", { path: next });
  return response;
}
