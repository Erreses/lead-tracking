/**
 * Runs once when the server process starts.
 *
 * Scrape jobs live in the server process, so a job still marked `running` in the
 * database belongs to a process that no longer exists. Without this sweep the
 * dashboard would show a progress bar that never moves again.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { recoverInterruptedJobs } = await import("@/lib/scrape/runner");
  const recovered = recoverInterruptedJobs();

  if (recovered > 0) {
    console.log(
      `[lead-tracking] Marked ${recovered} interrupted scrape job(s) from a previous run.`,
    );
  }
}
