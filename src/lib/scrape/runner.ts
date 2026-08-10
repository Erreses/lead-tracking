import "server-only";

import { eq, sql } from "drizzle-orm";

import { getCategory } from "@/config/categories";
import { db } from "@/lib/db";
import { businesses, leadEvents, leads, scrapeJobs } from "@/lib/db/schema";
import {
  DEFAULT_DOMAIN_LISTS,
  classifyWebsite,
  isLead,
  scoreLead,
  type DomainLists,
} from "@/lib/leads/classify";
import { extraDomains } from "@/lib/settings";
import {
  COST_PER_REQUEST_USD,
  PlacesApiError,
  searchTextAllPages,
} from "@/lib/places/client";
import type { Place } from "@/lib/places/types";
import { generateGrid, subdivide, type Cell } from "./grid";

export type JobParams = {
  areaSlug: string;
  areaLabel: string;
  lat: number;
  lng: number;
  radius: number;
  categories: string[];
  cellRadius: number;
  maxDepth: number;
  maxRequests: number;
};

type WorkItem = { cell: Cell; categorySlug: string };

/** How many Places calls are in flight at once. */
const CONCURRENCY = 4;

/**
 * Jobs run inside the Next.js server process. Tracking them on `globalThis`
 * survives dev-server hot reloads, so cancelling still reaches the right job.
 */
type Registry = Map<number, { controller: AbortController }>;
const globalForJobs = globalThis as unknown as { __leadTrackingJobs?: Registry };
const running: Registry = (globalForJobs.__leadTrackingJobs ??= new Map());

export function isJobRunning(jobId: number): boolean {
  return running.has(jobId);
}

export function hasRunningJob(): boolean {
  return running.size > 0;
}

export function cancelJob(jobId: number): boolean {
  const entry = running.get(jobId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

/**
 * Any job still marked `running` when the process starts belongs to a server
 * that is no longer alive — otherwise the dashboard shows a progress bar that
 * will never move again.
 */
export function recoverInterruptedJobs(): number {
  const result = db
    .update(scrapeJobs)
    .set({
      status: "interrupted",
      finishedAt: new Date(),
      error: "Server restarted while this job was running.",
    })
    .where(eq(scrapeJobs.status, "running"))
    .run();

  return result.changes ?? 0;
}

function toBusinessRow(
  place: Place,
  categorySlug: string,
  areaLabel: string,
  lists: DomainLists,
) {
  const phone = place.nationalPhoneNumber ?? null;
  const { websiteClass, host } = classifyWebsite(place.websiteUri, lists);
  const rating = place.rating ?? null;
  const userRatingCount = place.userRatingCount ?? null;
  const businessStatus = place.businessStatus ?? null;

  return {
    placeId: place.id,
    name: place.displayName?.text ?? "(sin nombre)",
    address: place.formattedAddress ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    types: place.types ? JSON.stringify(place.types) : null,
    primaryCategory: categorySlug,
    phone,
    websiteUri: place.websiteUri ?? null,
    websiteHost: host,
    rating,
    userRatingCount,
    businessStatus,
    websiteClass,
    leadScore: scoreLead({
      websiteClass,
      rating,
      userRatingCount,
      phone,
      businessStatus,
    }),
    areaName: areaLabel,
    lastSeenAt: new Date(),
  };
}

/**
 * Insert or refresh a business, creating a lead when it has no real website.
 * Returns what changed so the job counters stay accurate.
 */
function upsertPlace(
  place: Place,
  categorySlug: string,
  areaLabel: string,
  lists: DomainLists,
): { isNew: boolean; leadCreated: boolean } {
  const row = toBusinessRow(place, categorySlug, areaLabel, lists);

  const existing = db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.placeId, row.placeId))
    .get();

  let businessId: number;
  let isNew = false;

  if (existing) {
    // Keep the category that first found it; re-running a different sweep
    // shouldn't relabel a business you've already been working.
    const { primaryCategory, ...updatable } = row;
    void primaryCategory;
    db.update(businesses).set(updatable).where(eq(businesses.id, existing.id)).run();
    businessId = existing.id;
  } else {
    const inserted = db
      .insert(businesses)
      .values({ ...row, firstSeenAt: new Date() })
      .returning({ id: businesses.id })
      .get();
    businessId = inserted.id;
    isNew = true;
  }

  if (!isLead(row.websiteClass)) return { isNew, leadCreated: false };

  const existingLead = db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.businessId, businessId))
    .get();

  if (existingLead) return { isNew, leadCreated: false };

  const lead = db
    .insert(leads)
    .values({ businessId, status: "new" })
    .returning({ id: leads.id })
    .get();

  db.insert(leadEvents)
    .values({
      leadId: lead.id,
      type: "created",
      message: `Found in ${areaLabel} while searching "${categorySlug}".`,
    })
    .run();

  return { isNew, leadCreated: true };
}

/**
 * Sweep an area: tile it, query each cell for each category, subdivide the
 * cells that come back full, and stop cleanly when cancelled or when the
 * request budget runs out.
 */
export async function runJob(jobId: number, params: JobParams): Promise<void> {
  const controller = new AbortController();
  running.set(jobId, { controller });

  // Read the user's extra directory domains once, so every place in this job is
  // judged against the same rules.
  const domainLists: DomainLists = {
    ...DEFAULT_DOMAIN_LISTS,
    aggregator: [...DEFAULT_DOMAIN_LISTS.aggregator, ...extraDomains()],
  };

  const counters = {
    requests: 0,
    businesses: 0,
    newBusinesses: 0,
    leads: 0,
    cellsDone: 0,
    saturated: 0,
  };

  // Warn about types Google rejects once, then fall back to plain text search.
  const droppedTypes = new Set<string>();

  const queue: WorkItem[] = [];
  const initialCells = generateGrid(
    { lat: params.lat, lng: params.lng, radius: params.radius },
    params.cellRadius,
  );
  for (const cell of initialCells) {
    for (const categorySlug of params.categories) queue.push({ cell, categorySlug });
  }

  let cellsTotal = queue.length;
  let stoppedReason: string | null = null;

  const syncProgress = () => {
    db.update(scrapeJobs)
      .set({
        cellsTotal,
        cellsDone: counters.cellsDone,
        requestsMade: counters.requests,
        estimatedCostUsd:
          Math.round(counters.requests * COST_PER_REQUEST_USD * 1000) / 1000,
        businessesFound: counters.businesses,
        newBusinesses: counters.newBusinesses,
        leadsCreated: counters.leads,
        saturatedCells: counters.saturated,
      })
      .where(eq(scrapeJobs.id, jobId))
      .run();
  };

  db.update(scrapeJobs)
    .set({ status: "running", startedAt: new Date(), cellsTotal })
    .where(eq(scrapeJobs.id, jobId))
    .run();

  const budgetReached = () => counters.requests >= params.maxRequests;

  const cancelledByUser = () => {
    const row = db
      .select({ cancelRequested: scrapeJobs.cancelRequested })
      .from(scrapeJobs)
      .where(eq(scrapeJobs.id, jobId))
      .get();
    return Boolean(row?.cancelRequested);
  };

  async function processItem(item: WorkItem): Promise<void> {
    const category = getCategory(item.categorySlug);
    if (!category) return;

    const useType =
      category.includedType && !droppedTypes.has(category.includedType)
        ? category.includedType
        : undefined;

    const request = {
      textQuery: category.textQuery,
      includedType: useType,
      circle: { lat: item.cell.lat, lng: item.cell.lng, radius: item.cell.radius },
    };

    let result;
    try {
      result = await searchTextAllPages(request, {
        signal: controller.signal,
        onRequest: () => {
          counters.requests++;
        },
      });
    } catch (error) {
      // An `includedType` Google doesn't recognise fails the call with a 400.
      // Retry the same cell as a plain text search instead of losing it.
      if (error instanceof PlacesApiError && error.isInvalidArgument && useType) {
        droppedTypes.add(useType);
        result = await searchTextAllPages(
          { ...request, includedType: undefined },
          {
            signal: controller.signal,
            onRequest: () => {
              counters.requests++;
            },
          },
        );
      } else {
        throw error;
      }
    }

    for (const place of result.places ?? []) {
      const { isNew, leadCreated } = upsertPlace(
        place,
        item.categorySlug,
        params.areaLabel,
        domainLists,
      );
      counters.businesses++;
      if (isNew) counters.newBusinesses++;
      if (leadCreated) counters.leads++;
    }

    // A full result set means Google truncated the answer: split the cell and
    // look again at higher resolution.
    if (result.saturated) {
      if (item.cell.depth < params.maxDepth) {
        for (const child of subdivide(item.cell)) {
          queue.push({ cell: child, categorySlug: item.categorySlug });
          cellsTotal++;
        }
      } else {
        counters.saturated++;
      }
    }

    counters.cellsDone++;
  }

  try {
    // Workers pull from a queue that grows as cells subdivide.
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        if (controller.signal.aborted) return;

        if (budgetReached()) {
          stoppedReason = `Stopped at the ${params.maxRequests}-request budget cap.`;
          controller.abort();
          return;
        }

        if (cancelledByUser()) {
          stoppedReason = "Cancelled.";
          controller.abort();
          return;
        }

        const item = queue.shift();
        if (!item) return;

        await processItem(item);
        syncProgress();
      }
    });

    await Promise.all(workers);

    const cancelled = stoppedReason === "Cancelled.";
    syncProgress();
    db.update(scrapeJobs)
      .set({
        status: cancelled ? "cancelled" : "completed",
        stoppedReason,
        finishedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, jobId))
      .run();
  } catch (error) {
    syncProgress();
    db.update(scrapeJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, jobId))
      .run();
  } finally {
    running.delete(jobId);
  }
}

/** Total Places requests billed this calendar month, for the free-tier meter. */
export function requestsThisMonth(): number {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const row = db
    .select({ total: sql<number>`coalesce(sum(${scrapeJobs.requestsMade}), 0)` })
    .from(scrapeJobs)
    .where(sql`${scrapeJobs.createdAt} >= ${startOfMonth.getTime()}`)
    .get();

  return row?.total ?? 0;
}
