import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { leads, siteBuilds } from "@/lib/db/schema";
import { isAgentAvailable } from "@/lib/generate/agent";
import { isBuildRunning, startSiteBuild } from "@/lib/generate/runner";
import { logger } from "@/lib/log";
import { hasApiKey } from "@/lib/places/client";
import { siteBuildCostUsd } from "@/lib/places/pricing";

const log = logger("api.site");

/** The lead's business, or null if the id isn't one. */
async function businessFor(leadId: number) {
  const [row] = await db
    .select({ businessId: leads.businessId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  return row?.businessId ?? null;
}

/** Latest build for a business, for polling and for showing an existing site. */
async function latestBuild(businessId: number) {
  const [row] = await db
    .select({
      id: siteBuilds.id,
      slug: siteBuilds.slug,
      status: siteBuilds.status,
      photoCount: siteBuilds.photoCount,
      costUsd: siteBuilds.costUsd,
      error: siteBuilds.error,
      createdAt: siteBuilds.createdAt,
      finishedAt: siteBuilds.finishedAt,
    })
    .from(siteBuilds)
    .where(eq(siteBuilds.businessId, businessId))
    .orderBy(desc(siteBuilds.createdAt))
    .limit(1);
  return row ?? null;
}

/** Polled by the lead page while a build runs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/leads/[id]/site">) {
  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return NextResponse.json({ error: "Invalid lead id" }, { status: 400 });
  }

  const businessId = await businessFor(leadId);
  if (businessId == null) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const build = await latestBuild(businessId);

  return NextResponse.json({
    build,
    live: isBuildRunning(businessId),
    // Drives whether the button is offered at all. The CLI is on this machine,
    // not in the container on the VPS, so the same page has to render both ways.
    available: (await isAgentAvailable()) && hasApiKey(),
    estimatedCostUsd: siteBuildCostUsd(),
  });
}

/** Start a build. */
export async function POST(request: Request, ctx: RouteContext<"/api/leads/[id]/site">) {
  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return NextResponse.json({ error: "Invalid lead id" }, { status: 400 });
  }

  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY is not set, so Place Details cannot be fetched." },
      { status: 400 },
    );
  }

  if (!(await isAgentAvailable())) {
    return NextResponse.json(
      {
        error:
          "The `claude` CLI is not available here. Site generation runs on a machine with Claude Code installed.",
      },
      { status: 400 },
    );
  }

  const businessId = await businessFor(leadId);
  if (businessId == null) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const refresh = body?.refresh === true;

  const started = await startSiteBuild(businessId, { refresh });
  if (!started.ok) {
    return NextResponse.json({ error: started.error }, { status: started.status });
  }

  log.info("build.started", { leadId, businessId, buildId: started.buildId, refresh });

  return NextResponse.json(
    { buildId: started.buildId, slug: started.slug },
    { status: 202 },
  );
}
