import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { createBackup, MAX_BACKUPS } from "@/lib/db/backup";
import { scrapeJobs } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { hasApiKey } from "@/lib/places/client";
import { hasRunningJob, runJob } from "@/lib/scrape/runner";
import { jobRequestSchema, resolveJob } from "@/lib/scrape/params";

const log = logger("api.jobs");

export async function GET() {
  const jobs = await db
    .select()
    .from(scrapeJobs)
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(25);

  return NextResponse.json({ jobs });
}

/** Create a scrape job and start it in the background. */
export async function POST(request: Request) {
  if (!hasApiKey()) {
    log.warn("rejected.no_api_key", {
      hint: "GOOGLE_MAPS_API_KEY missing from .env.local, or the server wasn't restarted after adding it",
    });
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
    log.warn("rejected.already_running");
    return NextResponse.json(
      { error: "A scrape is already running. Wait for it to finish or cancel it." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    log.warn("rejected.invalid_request", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const resolved = resolveJob(parsed.data);
  if (!resolved.ok) {
    log.warn("rejected.unresolvable", { reason: resolved.error });
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const { job } = resolved;

  // A scrape is the only thing that writes leads in bulk, so snapshot the
  // database before it starts. Keeping the last few is enough to undo a bad run
  // without turning the data directory into an archive.
  let backup: string | null = null;
  let backupError: string | null = null;
  try {
    const info = await createBackup();
    backup = info.file;
    log.info("backup.created", { file: info.file, sizeBytes: info.sizeBytes });
  } catch (error) {
    // A failed snapshot is worth reporting, but not worth blocking the scrape:
    // the run itself is what the user asked for, and it adds rather than
    // destroys. The warning goes back with the response.
    backupError = error instanceof Error ? error.message : String(error);
    log.error("backup.failed", { note: "scrape proceeding without a snapshot" }, error);
  }

  const [created] = await db
    .insert(scrapeJobs)
    .values({
      areaName: job.areaLabel,
      params: JSON.stringify(job),
      status: "pending",
    })
    .returning({ id: scrapeJobs.id });

  // Deliberately not awaited: the job runs in the background and the dashboard
  // polls its progress. A crash inside it is recorded on the job row.
  log.info("job.created", {
    jobId: created.id,
    area: job.areaLabel,
    categories: job.categories.length,
    maxRequests: job.maxRequests,
    backup,
  });

  void runJob(created.id, job).catch((error) => {
    // runJob handles its own failures; reaching here means it threw outside
    // that, which would otherwise be an unhandled rejection with no trace.
    log.error("job.unhandled", { jobId: created.id }, error);
    void db
      .update(scrapeJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(scrapeJobs.id, created.id));
  });

  return NextResponse.json(
    { id: created.id, backup, backupError, maxBackups: MAX_BACKUPS },
    { status: 201 },
  );
}
