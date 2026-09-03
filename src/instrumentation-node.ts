/**
 * Node-only startup work, imported by `instrumentation.ts`.
 *
 * Two jobs, in order: bring the schema up to date, then clean up after whatever
 * the previous process was doing when it died.
 *
 * The body runs on import — there is no exported function to call, because
 * `register` awaiting the import is what sequences this before the first
 * request is served.
 */
export {};

// `next build` evaluates instrumentation too, and inside Docker the build stage
// has no database to reach — by design, since baking a DATABASE_URL into an
// image would mean baking in credentials. Runtime is where the real one appears.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  await start();
}

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[lead-tracking] DATABASE_URL is not set. Set it and restart — the app cannot read or write anything without it.",
    );
    return;
  }

  const { logger } = await import("@/lib/log");
  const log = logger("startup");

  try {
    const { runMigrations } = await import("@/lib/db/migrate");
    await runMigrations();
  } catch (error) {
    // Serving against a schema we don't understand corrupts data quietly, which
    // is far worse than a container that visibly refuses to start. Coolify will
    // show the crash loop and keep the previous deployment's container serving.
    log.error("migrations.failed", {}, error);
    console.error("[lead-tracking] Migrations failed — refusing to start.", error);
    process.exit(1);
  }

  try {
    // Scrape jobs live in the server process, so a job still marked `running` in
    // the database belongs to a process that no longer exists. Without this
    // sweep the dashboard would show a progress bar that never moves again.
    const { recoverInterruptedJobs } = await import("@/lib/scrape/runner");
    const recovered = await recoverInterruptedJobs();

    if (recovered > 0) {
      log.info("recovered interrupted jobs", { count: recovered });
      console.log(
        `[lead-tracking] Marked ${recovered} interrupted scrape job(s) from a previous run.`,
      );
    }
  } catch (error) {
    // Unlike migrations, this is housekeeping. A stale progress bar is not worth
    // refusing to serve over.
    log.error("recovery.failed", {}, error);
  }
}
