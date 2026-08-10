import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getCategory } from "@/config/categories";
import { db } from "@/lib/db";
import {
  businesses,
  leads,
  scrapeJobs,
  type LeadStatus,
  type WebsiteClass,
} from "@/lib/db/schema";
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

function countsByStatus(): Record<string, number> {
  const rows = db
    .select({ status: leads.status, count: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.status)
    .all();

  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

export function getOverview() {
  const totalBusinesses =
    db.select({ count: sql<number>`count(*)` }).from(businesses).get()?.count ?? 0;

  const totalLeads =
    db.select({ count: sql<number>`count(*)` }).from(leads).get()?.count ?? 0;

  const byStatus = countsByStatus();

  const funnel = FUNNEL_STAGES.map((stage, index) => ({
    label: stage.label,
    value: byStatus[stage.status] ?? 0,
    href: `/leads?status=${stage.status}`,
    color: FUNNEL_COLORS[index],
  }));

  const won = byStatus.won ?? 0;
  const lost = byStatus.lost ?? 0;
  const discarded = byStatus.discarded ?? 0;

  // Money still in play: quoted leads that haven't been won or lost yet.
  const openPipeline =
    db
      .select({ total: sql<number>`coalesce(sum(${leads.quoteAmount}), 0)` })
      .from(leads)
      .where(inArray(leads.status, ["demo_built", "contacted", "negotiating"]))
      .get()?.total ?? 0;

  const wonValue =
    db
      .select({ total: sql<number>`coalesce(sum(${leads.quoteAmount}), 0)` })
      .from(leads)
      .where(eq(leads.status, "won"))
      .get()?.total ?? 0;

  const byCategoryRows = db
    .select({
      category: businesses.primaryCategory,
      count: sql<number>`count(*)`,
    })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .groupBy(businesses.primaryCategory)
    .orderBy(desc(sql`count(*)`))
    .limit(10)
    .all();

  const byCategory = byCategoryRows.map((row) => ({
    label: getCategory(row.category ?? "")?.label ?? row.category ?? "Unknown",
    value: row.count,
    href: `/leads?category=${encodeURIComponent(row.category ?? "")}`,
  }));

  const byClassRows = db
    .select({
      websiteClass: businesses.websiteClass,
      count: sql<number>`count(*)`,
    })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .groupBy(businesses.websiteClass)
    .orderBy(desc(sql`count(*)`))
    .all();

  const byWebsiteClass = byClassRows.map((row) => ({
    label: WEBSITE_CLASS_LABELS[row.websiteClass as WebsiteClass] ?? row.websiteClass,
    value: row.count,
    href: `/leads?websiteClass=${row.websiteClass}`,
  }));

  const unchecked =
    db
      .select({ count: sql<number>`count(*)` })
      .from(businesses)
      .where(
        and(
          inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
          eq(businesses.websiteStatus, "unchecked"),
        ),
      )
      .get()?.count ?? 0;

  const topLeads = db
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
    .limit(8)
    .all();

  return {
    totalBusinesses,
    totalLeads,
    funnel,
    won,
    lost,
    discarded,
    openPipeline,
    wonValue,
    byCategory,
    byWebsiteClass,
    unchecked,
    topLeads,
  };
}

/** Places requests billed this calendar month, against the 1,000 free Enterprise calls. */
export function getApiUsage() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const requests =
    db
      .select({ total: sql<number>`coalesce(sum(${scrapeJobs.requestsMade}), 0)` })
      .from(scrapeJobs)
      .where(sql`${scrapeJobs.createdAt} >= ${startOfMonth.getTime()}`)
      .get()?.total ?? 0;

  const FREE_TIER = 1000;
  const billable = Math.max(0, requests - FREE_TIER);

  return {
    requests,
    freeTier: FREE_TIER,
    freeRemaining: Math.max(0, FREE_TIER - requests),
    billable,
    costUsd: Math.round(billable * 0.035 * 100) / 100,
  };
}
