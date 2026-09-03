/**
 * A shared-password gate for the deployed dashboard.
 *
 * There are no user accounts here and there shouldn't be — this is a tool for
 * two people. One password, held in an environment variable, unlocks the whole
 * app. What this protects against is the open internet: without it, publishing
 * the app on a URL would publish the lead database with it.
 *
 * Deliberately dependency-free and Web Crypto only, so the same code runs in
 * `proxy.ts` (edge runtime) and in a route handler (node).
 */

/** Cookie holding a signed session. HttpOnly, so page scripts can't read it. */
export const SESSION_COOKIE = "lt_session";

/** Long enough not to be a nuisance, short enough that a stolen laptop ages out. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The configured password, or null when the app is unprotected.
 *
 * Absent in local development on purpose: `npm run dev` should not ask you to
 * log in. In production the proxy refuses to serve at all if this is missing,
 * so "unprotected" can never happen by accident on a public URL.
 */
export function accessPassword(): string | null {
  const value = process.env.APP_ACCESS_PASSWORD;
  return value && value.length > 0 ? value : null;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(new Uint8Array(signature));
}

/**
 * Compare without leaking, through timing, how much of the value was right.
 *
 * Length is compared first and separately: it is not secret (the signature is a
 * fixed width), and a mismatch there means there is nothing to compare.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Mint a session token: an expiry, plus a signature over that expiry.
 *
 * Nothing secret is stored in the cookie — only a timestamp the server signed.
 * Because the key is the password itself, changing the password invalidates
 * every outstanding session, which is exactly what you want when someone leaves
 * or the password leaks.
 */
export async function createSessionToken(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [version, expiresAt, signature] = parts;
  if (version !== "v1") return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  // The signature is checked even for an expired token above only after the
  // cheap checks — an unsigned token can never pass here regardless.
  return timingSafeEqual(await sign(`${version}.${expiresAt}`, secret), signature);
}

/** Direct password check, for the login form and the `x-api-key` header. */
export function passwordMatches(candidate: string | null | undefined): boolean {
  const secret = accessPassword();
  if (!secret || !candidate) return false;
  return timingSafeEqual(candidate, secret);
}

/**
 * Whether the session cookie should be marked `Secure`.
 *
 * On by default in production, because Coolify serves the app over HTTPS. The
 * escape hatch exists for the one failure it would otherwise cause: reaching a
 * deployment over plain HTTP — a raw IP, or a domain before its certificate is
 * issued — where the browser accepts the cookie and then refuses to send it
 * back, so every login bounces straight back to the login page with no error.
 */
function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

/** Cookie attributes for a freshly minted session. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
