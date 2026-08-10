import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { businesses, leadEvents, leads, scrapeJobs } from "@/lib/db/schema";
import { runJob, type JobParams } from "./runner";

/**
 * End-to-end exercise of the scrape pipeline with the Places API stubbed:
 * grid → search → classify → upsert → lead. No network, no API key, no spend.
 */

type StubPlace = {
  id: string;
  displayName: { text: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
};

/** Mixed website situations, so the classifier has something to decide. */
function placesForCell(cellKey: string): StubPlace[] {
  return [
    {
      id: `${cellKey}-1`,
      displayName: { text: "Peluquería Sin Web" },
      nationalPhoneNumber: "912 345 678",
      rating: 4.6,
      userRatingCount: 120,
      businessStatus: "OPERATIONAL",
    },
    {
      id: `${cellKey}-2`,
      displayName: { text: "Barbería Facebook" },
      websiteUri: "https://www.facebook.com/barberiafb",
      rating: 4.2,
      userRatingCount: 40,
      businessStatus: "OPERATIONAL",
    },
    {
      id: `${cellKey}-3`,
      displayName: { text: "Salón Con Web" },
      websiteUri: "https://salonconweb.es",
      rating: 4.9,
      userRatingCount: 300,
      businessStatus: "OPERATIONAL",
    },
    {
      id: `${cellKey}-4`,
      displayName: { text: "Peluquería Google Site" },
      websiteUri: "https://mipelu.business.site",
      businessStatus: "OPERATIONAL",
    },
    {
      id: `${cellKey}-5`,
      displayName: { text: "Estética Glovo" },
      websiteUri: "https://glovoapp.com/es/madrid/estetica",
      businessStatus: "OPERATIONAL",
    },
  ];
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let requestCount = 0;

/**
 * @param saturateAbove cells with a radius above this return a full 60 results,
 * which is what makes the runner subdivide them.
 */
function stubFetch(saturateAbove = Infinity) {
  requestCount = 0;

  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requestCount++;
    const body = JSON.parse(String(init.body));
    const { center, radius } = body.locationRestriction.circle;
    const cellKey = `${center.latitude.toFixed(4)}_${center.longitude.toFixed(4)}_${Math.round(radius)}`;

    if (radius > saturateAbove) {
      // Three full pages: 20 + 20 + 20 = 60, the API's hard ceiling.
      const page = body.pageToken ? Number(body.pageToken) : 1;
      const places = Array.from({ length: 20 }, (_, i) => ({
        id: `${cellKey}-p${page}-${i}`,
        displayName: { text: `Sin web ${page}-${i}` },
        businessStatus: "OPERATIONAL",
      }));
      return jsonResponse(
        page < 3 ? { places, nextPageToken: String(page + 1) } : { places },
      );
    }

    return jsonResponse({ places: placesForCell(cellKey) });
  });
}

function createJob(params: JobParams) {
  return db
    .insert(scrapeJobs)
    .values({
      areaName: params.areaLabel,
      params: JSON.stringify(params),
      status: "pending",
    })
    .returning({ id: scrapeJobs.id })
    .get().id;
}

const BASE: JobParams = {
  areaSlug: "test",
  areaLabel: "Test Area",
  lat: 40.4155,
  lng: -3.7074,
  // One cell exactly: cellRadius >= radius short-circuits the lattice.
  radius: 400,
  categories: ["peluqueria"],
  cellRadius: 400,
  maxDepth: 0,
  maxRequests: 100,
};

function reset() {
  db.delete(leadEvents).run();
  db.delete(leads).run();
  db.delete(businesses).run();
  db.delete(scrapeJobs).run();
}

beforeEach(reset);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runJob", () => {
  it("stores every business but only creates leads for those without a real website", async () => {
    stubFetch();
    const jobId = createJob(BASE);
    await runJob(jobId, BASE);

    const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get()!;
    expect(job.status).toBe("completed");

    const allBusinesses = db.select().from(businesses).all();
    expect(allBusinesses).toHaveLength(5);

    // 4 of the 5 lack a site of their own; only "Salón Con Web" has one.
    const allLeads = db.select().from(leads).all();
    expect(allLeads).toHaveLength(4);
    expect(job.leadsCreated).toBe(4);

    const classes = allBusinesses.map((b) => b.websiteClass).sort();
    expect(classes).toEqual([
      "aggregator_only",
      "google_site",
      "has_website",
      "none",
      "social_only",
    ]);

    const withSite = allBusinesses.find((b) => b.websiteClass === "has_website")!;
    expect(withSite.websiteHost).toBe("salonconweb.es");
    expect(withSite.leadScore).toBe(0);
  });

  it("scores the busiest reachable lead above the quiet ones", async () => {
    stubFetch();
    const jobId = createJob(BASE);
    await runJob(jobId, BASE);

    const noWebsite = db
      .select()
      .from(businesses)
      .where(eq(businesses.websiteClass, "none"))
      .get()!;
    const googleSite = db
      .select()
      .from(businesses)
      .where(eq(businesses.websiteClass, "google_site"))
      .get()!;

    // 120 reviews + 4.6 rating + a phone number beats a bare listing.
    expect(noWebsite.leadScore).toBeGreaterThan(googleSite.leadScore);
  });

  it("records why each lead was created", async () => {
    stubFetch();
    const jobId = createJob(BASE);
    await runJob(jobId, BASE);

    const events = db.select().from(leadEvents).all();
    expect(events).toHaveLength(4);
    expect(events[0].type).toBe("created");
    expect(events[0].message).toContain("Test Area");
  });

  it("deduplicates on re-scrape instead of piling up copies", async () => {
    stubFetch();
    const first = createJob(BASE);
    await runJob(first, BASE);

    const second = createJob(BASE);
    await runJob(second, BASE);

    expect(db.select().from(businesses).all()).toHaveLength(5);
    expect(db.select().from(leads).all()).toHaveLength(4);

    const secondJob = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, second)).get()!;
    expect(secondJob.businessesFound).toBe(5);
    expect(secondJob.newBusinesses).toBe(0);
    expect(secondJob.leadsCreated).toBe(0);
  });

  it("subdivides a cell that comes back full", async () => {
    // The 800 m parent saturates; its 566 m children do not.
    stubFetch(600);
    const params: JobParams = {
      ...BASE,
      radius: 800,
      cellRadius: 800,
      maxDepth: 1,
      maxRequests: 200,
    };
    const jobId = createJob(params);
    await runJob(jobId, params);

    const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get()!;
    expect(job.status).toBe("completed");
    // One parent cell plus the four children it split into.
    expect(job.cellsTotal).toBe(5);
    expect(job.cellsDone).toBe(5);
    // Nothing left saturated at max depth, because the children came back small.
    expect(job.saturatedCells).toBe(0);
    // 3 pages for the parent + 1 per child.
    expect(job.requestsMade).toBe(7);
  });

  it("flags cells still saturated at the deepest level rather than hiding them", async () => {
    stubFetch(0); // every cell saturates, at every depth
    const params: JobParams = {
      ...BASE,
      radius: 800,
      cellRadius: 800,
      maxDepth: 1,
      maxRequests: 200,
    };
    const jobId = createJob(params);
    await runJob(jobId, params);

    const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get()!;
    expect(job.saturatedCells).toBe(4);
  });

  it("stops at the budget cap and keeps what it already found", async () => {
    stubFetch(600);
    const params: JobParams = {
      ...BASE,
      radius: 3000,
      cellRadius: 700,
      maxDepth: 2,
      maxRequests: 5,
    };
    const jobId = createJob(params);
    await runJob(jobId, params);

    const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get()!;
    expect(job.stoppedReason).toContain("budget cap");
    // Workers finish the cell in hand, so a small overshoot past the cap is
    // expected — but it must be bounded, not unlimited.
    expect(job.requestsMade).toBeGreaterThanOrEqual(5);
    expect(job.requestsMade).toBeLessThan(5 + 4 * 3);
    expect(db.select().from(businesses).all().length).toBeGreaterThan(0);
  });

  it("marks the job failed when the API keeps erroring", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({ error: { message: "API key not authorized", status: "PERMISSION_DENIED" } }),
    }));

    const jobId = createJob(BASE);
    await runJob(jobId, BASE);

    const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get()!;
    expect(job.status).toBe("failed");
    expect(job.error).toContain("API key not authorized");
  });

  it("retries without includedType when Google rejects the type", async () => {
    let sawIncludedType = false;
    let calls = 0;

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body));
      if (body.includedType) {
        sawIncludedType = true;
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: { message: "Invalid included type", status: "INVALID_ARGUMENT" },
            }),
        } as unknown as Response;
      }
      return jsonResponse({ places: placesForCell("fallback") });
    });

    const jobId = createJob(BASE);
    await runJob(jobId, BASE);

    const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get()!;
    expect(sawIncludedType).toBe(true);
    expect(calls).toBe(2);
    // The cell was still swept, just as a plain text search.
    expect(job.status).toBe("completed");
    expect(db.select().from(businesses).all()).toHaveLength(5);
  });
});

describe("stub sanity", () => {
  it("counts the requests the runner actually made", async () => {
    stubFetch();
    const jobId = createJob(BASE);
    await runJob(jobId, BASE);
    expect(requestCount).toBe(1);
  });
});
