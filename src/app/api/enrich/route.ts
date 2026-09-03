import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { businesses, leadEvents, leads } from "@/lib/db/schema";
import { scoreLead } from "@/lib/leads/classify";
import { isSellableFinding, judgeStatus, type ProbeVerdict } from "@/lib/leads/website-status";
import { logger } from "@/lib/log";

const log = logger("enrich");

const TIMEOUT_MS = 8000;
const CONCURRENCY = 6;
const DEFAULT_BATCH = 100;

type ProbeResult = { status: ProbeVerdict; code: number | null };

/**
 * Is the site reachable? `HEAD` first because it's cheap, falling back to `GET`
 * for the many small-business hosts that reject or mishandle HEAD.
 */
async function probe(url: string): Promise<ProbeResult> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  for (const method of ["HEAD", "GET"] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(target, {
        method,
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; lead-tracking/1.0)" },
      });

      if (res.ok) return { status: "ok", code: res.status };
      // 4xx/5xx from HEAD is often just method rejection — try GET before judging.
      if (method === "GET") return { status: judgeStatus(res.status), code: res.status };
    } catch {
      // No response at all: DNS failure, connection refused, TLS failure or
      // timeout. This is the genuine article — nothing is there to serve a
      // customer either. Retry once as GET, then call it.
      if (method === "GET") return { status: "dead", code: null };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: "error", code: null };
}

/**
 * Check the businesses that claim to have a working website. A domain that no
 * longer resolves turns into a lead — those owners usually don't know their site
 * is down, which makes for an easy conversation.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Number(body?.limit) || DEFAULT_BATCH, 500);

  const candidates = (await db
    .select({
      id: businesses.id,
      websiteUri: businesses.websiteUri,
      rating: businesses.rating,
      userRatingCount: businesses.userRatingCount,
      phone: businesses.phone,
      businessStatus: businesses.businessStatus,
      name: businesses.name,
    })
    .from(businesses)
    .where(
      and(
        inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
        eq(businesses.websiteStatus, "unchecked"),
      ),
    )
    .limit(limit)).filter((row) => row.websiteUri);

  let checked = 0;
  let dead = 0;
  let blocked = 0;
  let newLeads = 0;

  const runLog = log.child({ requested: limit, candidates: candidates.length });
  runLog.info("start");

  const queue = [...candidates];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;

      const result = await probe(row.websiteUri!);
      checked++;
      if (result.status === "blocked") blocked++;

      const isDead = isSellableFinding(result.status);

      await db
        .update(businesses)
        .set({
          websiteStatus: result.status,
          websiteStatusCode: result.code,
          websiteCheckedAt: new Date(),
          ...(isDead
            ? {
                websiteClass: "dead" as const,
                leadScore: scoreLead({
                  websiteClass: "dead",
                  rating: row.rating,
                  userRatingCount: row.userRatingCount,
                  phone: row.phone,
                  businessStatus: row.businessStatus,
                }),
              }
            : {}),
        })
        .where(eq(businesses.id, row.id));

      if (!isDead) continue;
      dead++;

      const [existingLead] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.businessId, row.id))
        .limit(1);

      if (existingLead) continue;

      const [lead] = await db
        .insert(leads)
        .values({ businessId: row.id, status: "new" })
        .returning({ id: leads.id });

      await db.insert(leadEvents).values({
          leadId: lead.id,
          type: "created",
          message: `Website ${row.websiteUri} did not respond — promoted to a lead.`,
      });

      newLeads++;
    }
  });

  await Promise.all(workers);

  const remaining = (await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
        eq(businesses.websiteStatus, "unchecked"),
      ),
    )
    ).length;

  runLog.info("done", { checked, dead, blocked, newLeads, remaining, ms: runLog.since() });

  return NextResponse.json({ checked, dead, blocked, newLeads, remaining });
}
