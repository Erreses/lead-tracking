import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { businesses, leads } from "@/lib/db/schema";
import { DEFAULT_FILTERS, foldAccents, queryLeads } from "./query";

/**
 * Search regressions are invisible: a query that matches too little returns a
 * shorter list, not an error. This one shipped — SQLite's LIKE ignores case and
 * Postgres's does not, so after the port every lowercase search quietly hid most
 * of the answer.
 */

const FIXTURES = [
  { placeId: "search-test-1", name: "Bar Loreto", address: "Calle de Hartzenbusch, 7" },
  { placeId: "search-test-2", name: "Peluquería Sin Web", address: "Calle Mayor, 1" },
  { placeId: "search-test-3", name: "El Sueño de Carmen", address: "Plaza del Sol, 2" },
  { placeId: "search-test-4", name: "PIZZERÍA CENTRAL", address: "Gran Vía, 3" },
];

/** Search exactly as the page does, with everything else left at its default. */
async function findByName(term: string): Promise<string[]> {
  const rows = await queryLeads({ ...DEFAULT_FILTERS, search: term }, 50, 0);
  return rows.map((r) => r.name).sort();
}

beforeAll(async () => {
  for (const fixture of FIXTURES) {
    const [business] = await db
      .insert(businesses)
      .values({ ...fixture, websiteClass: "none" })
      .returning({ id: businesses.id });
    await db.insert(leads).values({ businessId: business.id });
  }
});

afterAll(async () => {
  for (const fixture of FIXTURES) {
    const [business] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.placeId, fixture.placeId))
      .orderBy(desc(businesses.id))
      .limit(1);
    if (!business) continue;
    await db.delete(leads).where(eq(leads.businessId, business.id));
    await db.delete(businesses).where(eq(businesses.id, business.id));
  }
});

describe("lead search", () => {
  it("ignores case, which Postgres LIKE does not", async () => {
    // The actual reported bug: typing the name in lower case found nothing.
    expect(await findByName("bar loreto")).toContain("Bar Loreto");
    expect(await findByName("BAR LORETO")).toContain("Bar Loreto");
    expect(await findByName("Bar Loreto")).toContain("Bar Loreto");
  });

  it("finds accented names typed without accents", async () => {
    // Nobody types "Peluquería" into a search box.
    expect(await findByName("peluqueria")).toContain("Peluquería Sin Web");
    expect(await findByName("sueno")).toContain("El Sueño de Carmen");
    expect(await findByName("pizzeria")).toContain("PIZZERÍA CENTRAL");
  });

  it("still finds them when the accents are typed", async () => {
    expect(await findByName("peluquería")).toContain("Peluquería Sin Web");
    expect(await findByName("sueño")).toContain("El Sueño de Carmen");
  });

  it("matches part of a word, anywhere in the name", async () => {
    expect(await findByName("loret")).toContain("Bar Loreto");
    expect(await findByName("central")).toContain("PIZZERÍA CENTRAL");
  });

  it("searches the address as well as the name", async () => {
    expect(await findByName("hartzenbusch")).toContain("Bar Loreto");
    // Accent folding has to apply to the address too, not just the name.
    expect(await findByName("gran via")).toContain("PIZZERÍA CENTRAL");
  });

  it("returns nothing for a term that genuinely does not match", async () => {
    expect(await findByName("zzzznotabusiness")).toEqual([]);
  });
});

describe("foldAccents", () => {
  it("strips the mark and keeps the letter", () => {
    expect(foldAccents("Peluquería")).toBe("Peluqueria");
    expect(foldAccents("El Sueño")).toBe("El Sueno");
    expect(foldAccents("Duratón")).toBe("Duraton");
    expect(foldAccents("Ibáñez")).toBe("Ibanez");
  });

  it("leaves unaccented text alone", () => {
    expect(foldAccents("Bar Loreto")).toBe("Bar Loreto");
    expect(foldAccents("")).toBe("");
  });
});
