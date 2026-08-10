import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { scrapeJobs } from "@/lib/db/schema";
import { hasApiKey } from "@/lib/places/client";
import { hasRunningJob, runJob } from "@/lib/scrape/runner";
import { jobRequestSchema, resolveJob } from "@/lib/scrape/params";

export async function GET() {
  const jobs = db
    .select()
    .from(scrapeJobs)
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(25)
    .all();

  return NextResponse.json({ jobs });
}

/** Create a scrape job and start it in the background. */
export async function POST(request: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local and restart the dev server.",
      },
      { status: 400 },
    );
  }

  // Jobs share one request budget and one SQLite file; running several at once
  // makes both the spend and the progress bar meaningless.
  if (hasRunningJob()) {
    return NextResponse.json(
      { error: "A scrape is already running. Wait for it to finish or cancel it." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const resolved = resolveJob(parsed.data);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const { job } = resolved;
  const created = db
    .insert(scrapeJobs)
    .values({
      areaName: job.areaLabel,
      params: JSON.stringify(job),
      status: "pending",
    })
    .returning({ id: scrapeJobs.id })
    .get();

  // Deliberately not awaited: the job runs in the background and the dashboard
  // polls its progress. A crash inside it is recorded on the job row.
  void runJob(created.id, job).catch((error) => {
    db.update(scrapeJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, created.id))
      .run();
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
