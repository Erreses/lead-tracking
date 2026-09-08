import { describe, expect, it } from "vitest";

import { findImageReference } from "./agent";

/**
 * This check is what keeps Google's licensed photographs out of a public
 * repository, so it has to reject every way one could get onto a page — and
 * accept the vector drawing the design brief asks for, which looks almost
 * identical in the source.
 */

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe("findImageReference", () => {
  it("allows an SVG filter reference, raw and percent-encoded", () => {
    // The grain texture in the design brief is exactly this, and an earlier
    // version of the check failed the build over it.
    expect(findImageReference(page(`<style>.a{filter:url(#grain)}</style>`))).toBeNull();
    expect(
      findImageReference(
        page(
          `<style>.hero::after{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.85'/%3E%3C/filter%3E%3Crect filter='url(%23n)'/%3E%3C/svg%3E")}</style>`,
        ),
      ),
    ).toBeNull();
  });

  it("allows inline svg and vector data URIs", () => {
    expect(findImageReference(page(`<svg viewBox="0 0 10 10"><circle r="4"/></svg>`))).toBeNull();
    expect(
      findImageReference(page(`<style>.m{background:url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)}</style>`)),
    ).toBeNull();
  });

  it("rejects an img tag however it is written", () => {
    expect(findImageReference(page(`<img src="photo-1.jpg">`))).toContain("<img");
    expect(findImageReference(page(`<IMG SRC='photo-1.jpg' alt="x">`))).toContain("IMG");
    expect(findImageReference(page(`<img\n  src="/demos/x/photo-1.png"\n>`))).toContain("img");
  });

  it("rejects a css url pointing at a file", () => {
    expect(findImageReference(page(`<style>.h{background:url(photo-1.jpg)}</style>`))).toContain("photo-1.jpg");
    expect(findImageReference(page(`<style>.h{background:url('./photo-2.png')}</style>`))).toContain("photo-2.png");
    expect(findImageReference(page(`<style>.h{background:url("../photo-3.jpg")}</style>`))).toContain("photo-3.jpg");
  });

  it("rejects a remote image", () => {
    expect(
      findImageReference(page(`<style>.h{background:url(https://example.com/a.jpg)}</style>`)),
    ).toContain("example.com");
  });

  it("rejects a photograph smuggled in as a data URI", () => {
    // The subtle one: still a licensed photograph, just base64'd.
    expect(
      findImageReference(page(`<style>.h{background:url(data:image/jpeg;base64,/9j/4AAQSkZJRg==)}</style>`)),
    ).toContain("jpeg");
    expect(
      findImageReference(page(`<style>.h{background:url(data:image/png;base64,iVBORw0KGgo=)}</style>`)),
    ).toContain("png");
  });

  it("passes a page that only uses colour, type and drawn vector", () => {
    expect(
      findImageReference(
        page(`<style>
          .hero{background:radial-gradient(ellipse at 20% -10%,#a8241a,transparent 55%),linear-gradient(170deg,#8c1c13,#5c120c)}
          .rule{border-top:1px solid rgba(201,162,39,.3)}
        </style>
        <svg><pattern id="gingham"><rect width="8" height="8"/></pattern></svg>
        <div class="hero"></div>`),
      ),
    ).toBeNull();
  });
});
