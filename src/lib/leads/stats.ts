import "server-only";

import { and, desc, eq, gte, inArray, notLike, sql, type SQL } from "drizzle-orm";

import { getCategory } from "@/config/categories";
import { db } from "@/lib/db";
import {
  DEMO_AREA_PREFIX,
  businesses,
  leads,
  scrapeJobs,
  type LeadStatus,
  type WebsiteClass,
} from "@/lib/db/schema";
import { COST_PER_REQUEST_USD, FREE_REQUESTS_PER_MONTH } from "@/lib/places/pricing";
import { WEBSITE_CLASS_LABELS } from "./classify";

/**
 * The pipeline proper. `won` and `lost` are outcomes rather than stages — a won
 * lead has left the funnel — so they're reported separately instead of being
 * drawn as a sixth bar.
 */
export const FUNNEL_STAGES: { status: LeadStatus; label: string }[] = [
  { status: "new", label: "New" },
  { status: "qualified", label: "Qualified" },
  { status: "demo_built", label: "Demo built" },
  { status: "contacted", label: "Contacted" },
  { status: "negotiating", label: "Negotiating" },
];

/** Ordinal blue ramp, validated light and dark (monotone L, gaps ≥ 0.06). */
export const FUNNEL_COLORS = [
  "var(--funnel-1)",
  "var(--funnel-2)",
  "var(--funnel-3)",
  "var(--funnel-4)",
  "var(--funnel-5)",
];

async function countsByStatus(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: leads.status, count: sql<number>`count(*)::int` })
    .from(leads)
    .groupBy(leads.status);

  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/**
 * Every aggregate carries an explicit cast. Postgres returns `count` as
 * `bigint` and `sum` over a float as `numeric`, both of which the driver hands
 * back as strings rather than lose precision — uncast, they arrive as "808"
 * and quietly poison the arithmetic downstream.
 */
export async function getOverview() {
  const count = sql<number>`count(*)::int`;
  const money = (where?: SQL) =>
    db
      .select({ total: sql<number>`coalesce(sum(${leads.quoteAmount}), 0)::float` })
      .from(leads)
      .where(where);

  // Independent reads, so they go out together rather than in series — over a
  // network connection the difference is the whole page's latency.
  const [
    [businessCount],
    [leadCount],
    byStatus,
    [openRow],
    [wonRow],
    byCategoryRows,
    byClassRows,
    [uncheckedRow],
    topLeads,
  ] = await Promise.all([
    db.select({ count }).from(businesses),
    db.select({ count }).from(leads),
    countsByStatus(),
    money(inArray(leads.status, ["demo_built", "contacted", "negotiating"])),
    money(eq(leads.status, "won")),
    db
      .select({ category: businesses.primaryCategory, count })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .groupBy(businesses.primaryCategory)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db
      .select({ websiteClass: businesses.websiteClass, count })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .groupBy(businesses.websiteClass)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ count })
      .from(businesses)
      .where(
        and(
          inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
          eq(businesses.websiteStatus, "unchecked"),
        ),
      ),
    db
      .select({
        id: leads.id,
        name: businesses.name,
        score: businesses.leadScore,
        category: businesses.primaryCategory,
        reviews: businesses.userRatingCount,
        rating: businesses.rating,
        websiteClass: businesses.websiteClass,
      })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(eq(leads.status, "new"))
      .orderBy(desc(businesses.leadScore))
      .limit(8),
  ]);

  const funnel = FUNNEL_STAGES.map((stage, index) => ({
    label: stage.label,
    value: byStatus[stage.status] ?? 0,
    href: `/leads?status=${stage.status}`,
    color: FUNNEL_COLORS[index],
  }));

  const byCategory = byCategoryRows.map((row) => ({
    label: getCategory(row.category ?? "")?.label ?? row.category ?? "Unknown",
    value: row.count,
    href: `/leads?category=${encodeURIComponent(row.category ?? "")}`,
  }));

  const byWebsiteClass = byClassRows.map((row) => ({
    label: WEBSITE_CLASS_LABELS[row.websiteClass as WebsiteClass] ?? row.websiteClass,
    value: row.count,
    href: `/leads?websiteClass=${row.websiteClass}`,
  }));

  return {
    totalBusinesses: businessCount?.count ?? 0,
    totalLeads: leadCount?.count ?? 0,
    funnel,
    won: byStatus.won ?? 0,
    lost: byStatus.lost ?? 0,
    discarded: byStatus.discarded ?? 0,
    openPipeline: openRow?.total ?? 0,
    wonValue: wonRow?.total ?? 0,
    byCategory,
    byWebsiteClass,
    unchecked: uncheckedRow?.count ?? 0,
    topLeads,
  };
}

/**
 * Places requests billed this calendar month, against the free Enterprise
 * allowance. Demo jobs are excluded — `seed:demo` writes a job row claiming
 * requests it never made, and counting those would show spend against a
 * database that has never touched Google.
 */
export async function getApiUsage() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${scrapeJobs.requestsMade}), 0)::int` })
    .from(scrapeJobs)
    .where(
      and(
        gte(scrapeJobs.createdAt, startOfMonth),
        notLike(scrapeJobs.areaName, `${DEMO_AREA_PREFIX}%`),
      ),
    );

  const requests = row?.total ?? 0;

  const billable = Math.max(0, requests - FREE_REQUESTS_PER_MONTH);

  return {
    requests,
    freeTier: FREE_REQUESTS_PER_MONTH,
    freeRemaining: Math.max(0, FREE_REQUESTS_PER_MONTH - requests),
    billable,
    costUsd: Math.round(billable * COST_PER_REQUEST_USD * 100) / 100,
  };
}
