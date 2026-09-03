import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { businesses, scrapeJobs } from "@/lib/db/schema";
import { getApiUsage } from "@/lib/leads/stats";
import { logger } from "@/lib/log";
import { cancelJob, isJobRunning } from "@/lib/scrape/runner";
import { summarizeJob, type JobFacts } from "@/lib/scrape/summary";

const log = logger("api.jobs");

/** Resolved params were snapshotted onto the row when the job was created. */
function paramsOf(raw: string): Pick<JobFacts, "cellRadius" | "maxDepth" | "maxRequests" | "categories"> {
  try {
    const parsed = JSON.parse(raw);
    return {
      cellRadius: Number(parsed.cellRadius) || 0,
      maxDepth: Number(parsed.maxDepth) || 0,
      maxRequests: Number(parsed.maxRequests) || 0,
      categories: Array.isArray(parsed.categories) ? parsed.categories.length : 0,
    };
  } catch {
    // A hand-edited or demo row. The summary degrades rather than 500s.
    return { cellRadius: 0, maxDepth: 0, maxRequests: 0, categories: 0 };
  }
}

/** Businesses that look like they have a site but have never been probed. */
async function uncheckedWebsites(): Promise<number> {
  const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(businesses)
      .where(
        and(
          inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
          eq(businesses.websiteStatus, "unchecked"),
        ),
      )
  return row?.count ?? 0;
}

/** Polled by the Scrape page while a job runs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const [job] = await db
    .select()
    .from(scrapeJobs)
    .where(eq(scrapeJobs.id, jobId))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const live = isJobRunning(jobId);

  // Only worth computing once the run is over — mid-run counters would produce
  // advice that contradicts itself as the numbers move.
  const usage = live ? null : await getApiUsage();
  const summary =
    live || usage == null
      ? null
      : summarizeJob(
          {
            status: job.status,
            stoppedReason: job.stoppedReason,
            error: job.error,
            requestsMade: job.requestsMade,
            estimatedCostUsd: job.estimatedCostUsd,
            resultsSeen: job.resultsSeen,
            businessesFound: job.businessesFound,
            newBusinesses: job.newBusinesses,
            leadsCreated: job.leadsCreated,
            cellsTotal: job.cellsTotal,
            cellsDone: job.cellsDone,
            cellsSkipped: job.cellsSkipped,
            saturatedCells: job.saturatedCells,
            ...paramsOf(job.params),
          },
          {
            uncheckedWebsites: await uncheckedWebsites(),
            requestsThisMonth: usage.requests,
            freeTierLimit: usage.freeTier,
          },
        );

  return NextResponse.json({ job, live, summary });
}

/**
 * Request cancellation. The runner checks this flag between cells, so the job
 * stops at a clean boundary and keeps everything it has already found.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const [job] = await db
    .select()
    .from(scrapeJobs)
    .where(eq(scrapeJobs.id, jobId))
    .limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  await db
    .update(scrapeJobs)
    .set({ cancelRequested: true })
    .where(eq(scrapeJobs.id, jobId));

  log.info("cancel.requested", { jobId, requestsMade: job.requestsMade });
  cancelJob(jobId);

  return NextResponse.json({ ok: true });
}
