import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  businesses,
  cellCoverage,
  leadEvents,
  leads,
  scrapeJobs,
  settings,
} from "@/lib/db/schema";
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

    // Answer a wrong-shaped request the way Google does, instead of throwing.
    // A throwing stub sends the client into its retry backoff and the test dies
    // of a timeout — which says nothing about what was actually wrong.
    if (!body.locationRestriction?.rectangle) {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              status: "INVALID_ARGUMENT",
              message: `Invalid JSON payload received. Unknown name "${
                Object.keys(body.locationRestriction ?? {})[0] ?? "?"
              }" at 'location_restriction': Cannot find field.`,
            },
          }),
      } as unknown as Response;
    }

    // The rectangle is the cell circle's bounding box, so the centre is its
    // midpoint and the radius is half its latitude span.
    const { low, high } = body.locationRestriction.rectangle;
    const center = {
      latitude: (low.latitude + high.latitude) / 2,
      longitude: (low.longitude + high.longitude) / 2,
    };
    const radius = ((high.latitude - low.latitude) / 2) * 111_320;
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

async function createJob(params: JobParams) {
  const [row] = await db
    .insert(scrapeJobs)
    .values({
      areaName: params.areaLabel,
      params: JSON.stringify(params),
      status: "pending",
    })
    .returning({ id: scrapeJobs.id });

  return row.id;
}

/** First row of a query, for the many places a test expects exactly one. */
async function first<T>(query: PromiseLike<T[]>): Promise<T> {
  const [row] = await query;
  return row;
}

/** The job row under test, re-read after the run finished. */
function jobRow(id: number) {
  return first(db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id)));
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

async function reset() {
  await db.delete(leadEvents);
  await db.delete(leads);
  await db.delete(businesses);
  await db.delete(scrapeJobs);
  // Coverage outlives a job by design, so it has to be cleared explicitly or
  // every test after the first would skip its searches as already swept.
  await db.delete(cellCoverage);
  await db.delete(settings);
}

beforeEach(reset);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runJob", () => {
  it("stores every business but only creates leads for those without a real website", async () => {
    stubFetch();
    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);

    const job = await jobRow(jobId);
    expect(job.status).toBe("completed");

    const allBusinesses = await db.select().from(businesses);
    expect(allBusinesses).toHaveLength(5);

    // 4 of the 5 lack a site of their own; only "Salón Con Web" has one.
    const allLeads = await db.select().from(leads);
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
    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);

    const noWebsite = await first(
      db.select().from(businesses).where(eq(businesses.websiteClass, "none")),
    );
    const googleSite = await first(
      db.select().from(businesses).where(eq(businesses.websiteClass, "google_site")),
    );

    // 120 reviews + 4.6 rating + a phone number beats a bare listing.
    expect(noWebsite.leadScore).toBeGreaterThan(googleSite.leadScore);
  });

  it("records why each lead was created", async () => {
    stubFetch();
    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);

    const events = await db.select().from(leadEvents);
    expect(events).toHaveLength(4);
    expect(events[0].type).toBe("created");
    expect(events[0].message).toContain("Test Area");
  });

  it("deduplicates on re-scrape instead of piling up copies", async () => {
    stubFetch();
    const firstJob = await createJob(BASE);
    await runJob(firstJob, BASE);

    // Forced, because the coverage cache would otherwise skip the second sweep
    // entirely — and what's under test here is what happens when it does run.
    const rescrape: JobParams = { ...BASE, force: true };
    const second = await createJob(rescrape);
    await runJob(second, rescrape);

    expect(await db.select().from(businesses)).toHaveLength(5);
    expect(await db.select().from(leads)).toHaveLength(4);

    const secondJob = await jobRow(second);
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
    const jobId = await createJob(params);
    await runJob(jobId, params);

    const job = await jobRow(jobId);
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
    const jobId = await createJob(params);
    await runJob(jobId, params);

    const job = await jobRow(jobId);
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
    const jobId = await createJob(params);
    await runJob(jobId, params);

    const job = await jobRow(jobId);
    expect(job.stoppedReason).toContain("budget cap");
    // Workers finish the cell in hand, so a small overshoot past the cap is
    // expected — but it must be bounded, not unlimited.
    expect(job.requestsMade).toBeGreaterThanOrEqual(5);
    expect(job.requestsMade).toBeLessThan(5 + 4 * 3);
    expect((await db.select().from(businesses)).length).toBeGreaterThan(0);
  });

  it("marks the job failed when the API keeps erroring", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({ error: { message: "API key not authorized", status: "PERMISSION_DENIED" } }),
    }));

    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);

    const job = await jobRow(jobId);
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

    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);

    const job = await jobRow(jobId);
    expect(sawIncludedType).toBe(true);
    expect(calls).toBe(2);
    // The cell was still swept, just as a plain text search.
    expect(job.status).toBe("completed");
    expect(await db.select().from(businesses)).toHaveLength(5);
  });
});

describe("stub sanity", () => {
  it("counts the requests the runner actually made", async () => {
    stubFetch();
    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);
    expect(requestCount).toBe(1);
  });
});

/**
 * The coverage cache is the only thing that makes a repeat sweep cheaper —
 * Google bills per request and can't be asked to skip places we already have.
 * These check it actually stops requests going out, and never at the cost of
 * leaving part of an area unsearched.
 */
describe("coverage cache", () => {
  it("records every search it pays for", async () => {
    stubFetch();
    const jobId = await createJob(BASE);
    await runJob(jobId, BASE);

    const rows = await db.select().from(cellCoverage);
    expect(rows).toHaveLength(1);
    expect(rows[0].categorySlug).toBe("peluqueria");
    expect(rows[0].placesFound).toBe(5);
    expect(rows[0].radius).toBe(400);
  });

  it("makes an immediate re-run free", async () => {
    stubFetch();
    await runJob(await createJob(BASE), BASE);
    const afterFirst = requestCount;
    expect(afterFirst).toBe(1);

    const secondId = await createJob(BASE);
    await runJob(secondId, BASE);

    // Not one more request, and the job says why.
    expect(requestCount).toBe(afterFirst);
    const job = await jobRow(secondId);
    expect(job.status).toBe("completed");
    expect(job.cellsSkipped).toBe(1);
    expect(job.requestsMade).toBe(0);
    expect(job.estimatedCostUsd).toBe(0);
  });

  it("keeps the businesses the skipped run would have found", async () => {
    stubFetch();
    await runJob(await createJob(BASE), BASE);
    const before = (await db.select().from(businesses)).length;

    await runJob(await createJob(BASE), BASE);

    // Skipping a search must not remove anything already stored.
    expect(await db.select().from(businesses)).toHaveLength(before);
    expect(await db.select().from(leads)).toHaveLength(4);
  });

  it("re-sweeps at full price when forced", async () => {
    stubFetch();
    await runJob(await createJob(BASE), BASE);
    const afterFirst = requestCount;

    const forced = { ...BASE, force: true };
    const jobId = await createJob(forced);
    await runJob(jobId, forced);

    expect(requestCount).toBe(afterFirst + 1);
    const job = await jobRow(jobId);
    expect(job.cellsSkipped).toBe(0);
    expect(job.requestsMade).toBe(1);
  });

  it("sweeps again once the window has expired", async () => {
    stubFetch();
    await runJob(await createJob(BASE), BASE);
    const afterFirst = requestCount;

    // Backdate the sweep past the default 30-day window.
    await db
      .update(cellCoverage)
      .set({ sweptAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) });

    await runJob(await createJob(BASE), BASE);
    expect(requestCount).toBe(afterFirst + 1);
  });

  it("treats a coverage window of 0 as always sweep", async () => {
    stubFetch();
    await runJob(await createJob(BASE), BASE);
    const afterFirst = requestCount;

    await db.insert(settings).values({ key: "coverageTtlDays", value: "0" });

    await runJob(await createJob(BASE), BASE);
    expect(requestCount).toBe(afterFirst + 1);
  });

  it("treats a budget stop as a clean finish, not a failure", async () => {
    // A cap that bites mid-flight used to abort the in-flight fetch, which
    // surfaced as status "failed" with "This operation was aborted" — sending
    // the user hunting for a bug when the job did exactly what it was told.
    stubFetch();
    const params: JobParams = {
      ...BASE,
      categories: ["peluqueria", "barberia", "restaurante"],
      maxRequests: 1,
    };
    const jobId = await createJob(params);
    await runJob(jobId, params);

    const job = await jobRow(jobId);
    expect(job.status).toBe("completed");
    expect(job.error).toBeNull();
    expect(job.stoppedReason).toContain("budget cap");
    // The request that was already paid for still delivered its businesses.
    expect(job.businessesFound).toBeGreaterThan(0);
  });

  it("does not mark a search truncated at 60 results as covered", async () => {
    // The whole point of "re-run at a deeper level" is that it reaches these
    // cells. Recording them as covered would make that advice do nothing.
    stubFetch(0); // every cell saturates
    const params: JobParams = { ...BASE, maxDepth: 0 };
    const jobId = await createJob(params);
    await runJob(jobId, params);

    const job = await jobRow(jobId);
    expect(job.saturatedCells).toBe(1);
    expect(await db.select().from(cellCoverage)).toHaveLength(0);
  });

  it("lets a deeper re-run reach a cell that was truncated", async () => {
    stubFetch(300); // the 400 m cell saturates; its 283 m children do not
    const shallow: JobParams = { ...BASE, maxDepth: 0 };
    await runJob(await createJob(shallow), shallow);
    const afterShallow = requestCount;

    const deeper: JobParams = { ...BASE, maxDepth: 1 };
    const jobId = await createJob(deeper);
    await runJob(jobId, deeper);

    // It went back in rather than skipping, and this time it subdivided.
    expect(requestCount).toBeGreaterThan(afterShallow);
    const job = await jobRow(jobId);
    expect(job.cellsSkipped).toBe(0);
    expect(job.saturatedCells).toBe(0);
  });

  it("does not mark a budget-truncated search as covered", async () => {
    // Two categories, budget of 1: the second never runs, so it must not be
    // recorded — otherwise the window would hide it until it expired.
    stubFetch();
    const params: JobParams = {
      ...BASE,
      categories: ["peluqueria", "barberia"],
      maxRequests: 1,
    };
    await runJob(await createJob(params), params);

    const covered = await db.select().from(cellCoverage);
    expect(covered).toHaveLength(1);
    expect(covered[0].categorySlug).toBe("peluqueria");
  });
});
