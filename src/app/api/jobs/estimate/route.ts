import { NextResponse } from "next/server";

import { getApiUsage } from "@/lib/leads/stats";
import { estimateJob } from "@/lib/scrape/cost";
import { countCovered } from "@/lib/scrape/coverage";
import { generateGrid } from "@/lib/scrape/grid";
import { jobRequestSchema, resolveJob } from "@/lib/scrape/params";
import { coverageCutoff } from "@/lib/settings";
import { logger } from "@/lib/log";

const log = logger("api.estimate");

/**
 * Dry run: works out how many cells the area tiles into and what the sweep would
 * cost, without calling the Places API. This is what the Scrape page shows
 * before you commit to spending anything.
 */
export async function POST(request: Request) {
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
  const area = { lat: job.lat, lng: job.lng, radius: job.radius };

  // Searches this run would skip because a recent one already covered them.
  // Priced at zero, so the quote reflects the re-run rather than the first run.
  const cutoff = job.force ? null : await coverageCutoff();
  const covered =
    cutoff == null
      ? 0
      : await countCovered(generateGrid(area, job.cellRadius), job.categories, cutoff);

  // Subdivision multiplies the searches, and the free allowance is what you
  // actually pay against — both have to be in the number we show.
  const estimate = estimateJob(
    area,
    job.categories.length,
    job.cellRadius,
    job.maxDepth,
    (await getApiUsage()).requests,
    covered,
  );

  // Debug, not info: this fires on every keystroke in the form. It's here so a
  // surprising price on screen can be traced back to the inputs that produced it.
  log.debug("priced", {
    area: job.areaLabel,
    categories: job.categories.length,
    cellRadius: job.cellRadius,
    maxDepth: job.maxDepth,
    force: job.force,
    cells: estimate.cells,
    searches: estimate.searches,
    covered: estimate.coveredSearches,
    requests: `${estimate.minRequests}-${estimate.expectedRequests}`,
    expectedCostUsd: estimate.expectedCostUsd,
    expectedChargeUsd: estimate.freeTier.expectedChargeUsd,
  });

  return NextResponse.json({ estimate, job });
}
