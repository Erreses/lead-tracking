import { NextResponse } from "next/server";

import { estimateJob } from "@/lib/scrape/cost";
import { jobRequestSchema, resolveJob } from "@/lib/scrape/params";

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
  const estimate = estimateJob(
    { lat: job.lat, lng: job.lng, radius: job.radius },
    job.categories.length,
    job.cellRadius,
  );

  return NextResponse.json({ estimate, job });
}
