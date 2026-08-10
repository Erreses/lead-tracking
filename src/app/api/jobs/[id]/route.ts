import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { scrapeJobs } from "@/lib/db/schema";
import { cancelJob, isJobRunning } from "@/lib/scrape/runner";

/** Polled by the Scrape page while a job runs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) {
    return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  }

  const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ job, live: isJobRunning(jobId) });
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

  const job = db.select().from(scrapeJobs).where(eq(scrapeJobs.id, jobId)).get();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  db.update(scrapeJobs)
    .set({ cancelRequested: true })
    .where(eq(scrapeJobs.id, jobId))
    .run();

  cancelJob(jobId);

  return NextResponse.json({ ok: true });
}
