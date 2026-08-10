import { describe, expect, it } from "vitest";

import {
  classifyWebsite,
  extractHost,
  isLead,
  matchesDomain,
  scoreLead,
} from "./classify";

describe("extractHost", () => {
  it("pulls the hostname out of a full URL", () => {
    expect(extractHost("https://www.pizzeria-luigi.es/menu?x=1")).toBe("pizzeria-luigi.es");
  });

  it("accepts a bare host and assumes https", () => {
    expect(extractHost("pizzeria-luigi.es")).toBe("pizzeria-luigi.es");
  });

  it("strips only a leading www", () => {
    expect(extractHost("https://www2.example.com")).toBe("www2.example.com");
  });

  it("returns null for empty, missing or unusable values", () => {
    expect(extractHost(null)).toBeNull();
    expect(extractHost(undefined)).toBeNull();
    expect(extractHost("")).toBeNull();
    expect(extractHost("   ")).toBeNull();
    // No dot means it can't be a real public host.
    expect(extractHost("localhost")).toBeNull();
  });
});

describe("matchesDomain", () => {
  it("matches the domain itself and its subdomains", () => {
    expect(matchesDomain("facebook.com", ["facebook.com"])).toBe(true);
    expect(matchesDomain("m.facebook.com", ["facebook.com"])).toBe(true);
    expect(matchesDomain("es-es.facebook.com", ["facebook.com"])).toBe(true);
  });

  it("does not match a domain that merely ends with the same letters", () => {
    expect(matchesDomain("notfacebook.com", ["facebook.com"])).toBe(false);
    expect(matchesDomain("myfacebook.com", ["facebook.com"])).toBe(false);
  });

  it("does not match on a substring elsewhere in the host", () => {
    expect(matchesDomain("facebook.com.example.es", ["facebook.com"])).toBe(false);
  });
});

describe("classifyWebsite", () => {
  it("treats a missing website as the strongest lead", () => {
    expect(classifyWebsite(null).websiteClass).toBe("none");
    expect(classifyWebsite("").websiteClass).toBe("none");
    expect(classifyWebsite(undefined).websiteClass).toBe("none");
  });

  it("flags discontinued Google Business Profile sites", () => {
    expect(classifyWebsite("https://mi-bar.business.site").websiteClass).toBe("google_site");
    expect(classifyWebsite("https://mi-bar.negocio.site").websiteClass).toBe("google_site");
    expect(classifyWebsite("https://sites.google.com/view/mibar").websiteClass).toBe(
      "google_site",
    );
  });

  it("flags social and link-in-bio pages", () => {
    expect(classifyWebsite("https://www.facebook.com/barmanolo").websiteClass).toBe(
      "social_only",
    );
    expect(classifyWebsite("https://instagram.com/barmanolo").websiteClass).toBe(
      "social_only",
    );
    expect(classifyWebsite("https://linktr.ee/barmanolo").websiteClass).toBe("social_only");
  });

  it("flags marketplace-only listings", () => {
    expect(classifyWebsite("https://glovoapp.com/es/madrid/bar-manolo").websiteClass).toBe(
      "aggregator_only",
    );
    expect(classifyWebsite("https://www.thefork.es/restaurante/x").websiteClass).toBe(
      "aggregator_only",
    );
    expect(classifyWebsite("https://doctoralia.es/clinica-x").websiteClass).toBe(
      "aggregator_only",
    );
  });

  it("flags free builder subdomains separately from real sites", () => {
    expect(classifyWebsite("https://barmanolo.wixsite.com/inicio").websiteClass).toBe(
      "builder_subdomain",
    );
    expect(classifyWebsite("https://barmanolo.wordpress.com").websiteClass).toBe(
      "builder_subdomain",
    );
  });

  it("leaves a genuine site alone", () => {
    const result = classifyWebsite("https://www.barmanolo.es");
    expect(result.websiteClass).toBe("has_website");
    expect(result.host).toBe("barmanolo.es");
    expect(isLead(result.websiteClass)).toBe(false);
  });

  it("counts every other class as a lead", () => {
    for (const url of [
      null,
      "https://x.business.site",
      "https://facebook.com/x",
      "https://glovoapp.com/x",
      "https://x.wixsite.com",
    ]) {
      expect(isLead(classifyWebsite(url).websiteClass)).toBe(true);
    }
  });

  it("respects custom domain lists", () => {
    const lists = { social: [], google: [], aggregator: ["midirectorio.es"], builder: [] };
    expect(classifyWebsite("https://midirectorio.es/bar", lists).websiteClass).toBe(
      "aggregator_only",
    );
    // facebook is no longer in the list, so it now reads as a real site
    expect(classifyWebsite("https://facebook.com/bar", lists).websiteClass).toBe(
      "has_website",
    );
  });
});

describe("scoreLead", () => {
  it("scores a business with a working site at zero", () => {
    expect(
      scoreLead({ websiteClass: "has_website", rating: 4.8, userRatingCount: 500 }),
    ).toBe(0);
  });

  it("ranks a busy, well-rated, reachable business highest", () => {
    const busy = scoreLead({
      websiteClass: "none",
      rating: 4.7,
      userRatingCount: 300,
      phone: "+34 600 000 000",
      businessStatus: "OPERATIONAL",
    });
    const quiet = scoreLead({
      websiteClass: "none",
      rating: 4.7,
      userRatingCount: 2,
      businessStatus: "OPERATIONAL",
    });
    expect(busy).toBeGreaterThan(quiet);
    expect(busy).toBeLessThanOrEqual(100);
  });

  it("ignores ratings backed by too few reviews", () => {
    const withRating = scoreLead({ websiteClass: "none", rating: 5, userRatingCount: 2 });
    const withoutRating = scoreLead({ websiteClass: "none", userRatingCount: 2 });
    expect(withRating).toBe(withoutRating);
  });

  it("adds weight for a phone number you can call", () => {
    const withPhone = scoreLead({ websiteClass: "none", phone: "+34 600 000 000" });
    const withoutPhone = scoreLead({ websiteClass: "none" });
    expect(withPhone - withoutPhone).toBe(10);
  });

  it("heavily discounts businesses that are not operational", () => {
    const open = scoreLead({
      websiteClass: "none",
      userRatingCount: 100,
      businessStatus: "OPERATIONAL",
    });
    const closed = scoreLead({
      websiteClass: "none",
      userRatingCount: 100,
      businessStatus: "CLOSED_PERMANENTLY",
    });
    expect(closed).toBeLessThan(open / 2);
  });

  it("ranks no-website above a free-subdomain site, all else equal", () => {
    const base = { userRatingCount: 50, phone: "+34 600 000 000" } as const;
    expect(scoreLead({ ...base, websiteClass: "none" })).toBeGreaterThan(
      scoreLead({ ...base, websiteClass: "builder_subdomain" }),
    );
  });

  it("never leaves the 0-100 range", () => {
    const max = scoreLead({
      websiteClass: "none",
      rating: 5,
      userRatingCount: 10_000,
      phone: "+34 600 000 000",
      businessStatus: "OPERATIONAL",
    });
    expect(max).toBeLessThanOrEqual(100);
    expect(max).toBeGreaterThanOrEqual(0);
  });
});
