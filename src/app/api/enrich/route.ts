import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { businesses, leadEvents, leads } from "@/lib/db/schema";
import { scoreLead } from "@/lib/leads/classify";

const TIMEOUT_MS = 8000;
const CONCURRENCY = 6;
const DEFAULT_BATCH = 100;

type ProbeResult = { status: "ok" | "dead" | "error"; code: number | null };

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
      if (method === "GET") {
        return { status: res.status >= 400 ? "dead" : "ok", code: res.status };
      }
    } catch {
      // DNS failure, TLS failure or timeout. Retry once as GET, then give up.
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

  const candidates = db
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
    .limit(limit)
    .all()
    .filter((row) => row.websiteUri);

  let checked = 0;
  let dead = 0;
  let newLeads = 0;

  const queue = [...candidates];

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;

      const result = await probe(row.websiteUri!);
      checked++;

      const isDead = result.status === "dead";

      db.update(businesses)
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
        .where(eq(businesses.id, row.id))
        .run();

      if (!isDead) continue;
      dead++;

      const existingLead = db
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.businessId, row.id))
        .get();

      if (existingLead) continue;

      const lead = db
        .insert(leads)
        .values({ businessId: row.id, status: "new" })
        .returning({ id: leads.id })
        .get();

      db.insert(leadEvents)
        .values({
          leadId: lead.id,
          type: "created",
          message: `Website ${row.websiteUri} did not respond — promoted to a lead.`,
        })
        .run();

      newLeads++;
    }
  });

  await Promise.all(workers);

  const remaining = db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
        eq(businesses.websiteStatus, "unchecked"),
      ),
    )
    .all().length;

  return NextResponse.json({ checked, dead, newLeads, remaining });
}
