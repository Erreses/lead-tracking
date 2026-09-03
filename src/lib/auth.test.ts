import { afterEach, describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  accessPassword,
  createSessionToken,
  passwordMatches,
  sessionCookieOptions,
  verifySessionToken,
} from "./auth";

/**
 * The session cookie is the only thing standing between the open internet and
 * every lead in the database, so the cases that matter are the ones where a
 * token should be refused.
 */

const SECRET = "correct-horse-battery-staple";

afterEach(() => {
  delete process.env.APP_ACCESS_PASSWORD;
  delete process.env.COOKIE_SECURE;
});

describe("session tokens", () => {
  it("accepts a token it just minted", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("refuses a token signed with a different password", async () => {
    // Changing the password has to invalidate every outstanding session —
    // that is the only revocation mechanism there is.
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, "some-other-password")).toBe(false);
  });

  it("refuses a token whose signature has been altered", async () => {
    const token = await createSessionToken(SECRET);
    const [version, expiry, signature] = token.split(".");
    const tampered = `${version}.${expiry}.${signature.slice(0, -1)}${
      signature.endsWith("A") ? "B" : "A"
    }`;

    expect(await verifySessionToken(tampered, SECRET)).toBe(false);
  });

  it("refuses an expiry extended without re-signing", async () => {
    // The obvious forgery: keep the signature, push the date out.
    const token = await createSessionToken(SECRET);
    const [version, , signature] = token.split(".");
    const later = Date.now() + 10 * SESSION_MAX_AGE_SECONDS * 1000;

    expect(await verifySessionToken(`${version}.${later}.${signature}`, SECRET)).toBe(
      false,
    );
  });

  it("refuses an expired token even though it is correctly signed", async () => {
    // Hand-built rather than time-travelled, so the signature is genuine.
    const token = await createSessionToken(SECRET);
    const [version, expiry, signature] = token.split(".");
    expect(Number(expiry)).toBeGreaterThan(Date.now());

    const expired = `${version}.${Date.now() - 1000}.${signature}`;
    expect(await verifySessionToken(expired, SECRET)).toBe(false);
  });

  it("refuses malformed and missing tokens", async () => {
    for (const token of [undefined, "", "nonsense", "v1.123", "v2.123.abc", "a.b.c.d"]) {
      expect(await verifySessionToken(token, SECRET)).toBe(false);
    }
  });

  it("expires roughly SESSION_MAX_AGE_SECONDS from now", async () => {
    const token = await createSessionToken(SECRET);
    const expiry = Number(token.split(".")[1]);
    const expected = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;

    expect(Math.abs(expiry - expected)).toBeLessThan(5_000);
  });
});

describe("passwordMatches", () => {
  it("matches the configured password and nothing else", () => {
    process.env.APP_ACCESS_PASSWORD = SECRET;

    expect(passwordMatches(SECRET)).toBe(true);
    expect(passwordMatches("wrong")).toBe(false);
    // A prefix must not pass: the comparison is over the whole value.
    expect(passwordMatches(SECRET.slice(0, -1))).toBe(false);
    expect(passwordMatches(`${SECRET}x`)).toBe(false);
  });

  it("never matches when no password is configured", () => {
    // Otherwise an unset variable would turn into an open door for anyone
    // sending an empty x-api-key header.
    expect(accessPassword()).toBeNull();
    expect(passwordMatches("")).toBe(false);
    expect(passwordMatches("anything")).toBe(false);
    expect(passwordMatches(undefined)).toBe(false);
  });

  it("treats an empty password variable as unset", () => {
    process.env.APP_ACCESS_PASSWORD = "";
    expect(accessPassword()).toBeNull();
    expect(passwordMatches("")).toBe(false);
  });
});

describe("sessionCookieOptions", () => {
  it("always keeps the cookie away from page scripts and cross-site posts", () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it("is not Secure in development, so the cookie comes back over http", () => {
    // Tests run with NODE_ENV=test; a Secure cookie on plain-HTTP localhost is
    // accepted by the browser and then never sent again, which reads as a
    // login screen that silently loops.
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it("honours COOKIE_SECURE in both directions", () => {
    process.env.COOKIE_SECURE = "true";
    expect(sessionCookieOptions().secure).toBe(true);

    process.env.COOKIE_SECURE = "false";
    expect(sessionCookieOptions().secure).toBe(false);
  });
});
