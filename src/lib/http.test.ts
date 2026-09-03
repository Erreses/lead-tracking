import { describe, expect, it } from "vitest";

import { absoluteUrl, externalOrigin } from "./http";

/**
 * Redirects are the one place the app has to know its own public address, and
 * it gets that address from headers a proxy sets. Getting it wrong sends users
 * to `0.0.0.0:3000` — a real bug this suite exists to keep fixed.
 */

function request(headers: Record<string, string>) {
  return new Request("http://0.0.0.0:3000/api/login", { headers });
}

describe("externalOrigin", () => {
  it("prefers the forwarded host over the container's own", () => {
    expect(
      externalOrigin(
        request({
          host: "0.0.0.0:3000",
          "x-forwarded-host": "leads.example.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://leads.example.com");
  });

  it("assumes https when a proxy forwarded the host but not the protocol", () => {
    // Downgrading to http here would make the browser drop a Secure cookie.
    expect(externalOrigin(request({ "x-forwarded-host": "leads.example.com" }))).toBe(
      "https://leads.example.com",
    );
  });

  it("takes the first entry when several proxies have appended their own", () => {
    expect(
      externalOrigin(
        request({
          "x-forwarded-host": "leads.example.com, internal.lb",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://leads.example.com");
  });

  it("falls back to Host over plain http for a direct connection", () => {
    // Local development and the Docker healthcheck, neither behind a proxy.
    expect(externalOrigin(request({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores a forwarded protocol that isn't http or https", () => {
    expect(
      externalOrigin(
        request({ "x-forwarded-host": "leads.example.com", "x-forwarded-proto": "ftp" }),
      ),
    ).toBe("https://leads.example.com");
  });

  it("reports nothing when no host was sent at all", () => {
    expect(externalOrigin(new Request("http://0.0.0.0:3000/"))).toBeNull();
  });
});

describe("absoluteUrl", () => {
  it("builds the redirect against the address the browser used", () => {
    expect(
      absoluteUrl(
        request({ "x-forwarded-host": "leads.example.com", "x-forwarded-proto": "https" }),
        "/leads?page=2",
      ),
    ).toBe("https://leads.example.com/leads?page=2");
  });

  it("keeps the query string intact", () => {
    expect(
      absoluteUrl(request({ host: "localhost:3000" }), "/login?error=1&next=%2Fleads"),
    ).toBe("http://localhost:3000/login?error=1&next=%2Fleads");
  });
});
