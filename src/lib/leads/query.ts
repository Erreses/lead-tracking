import "server-only";

import { and, asc, desc, eq, gte, inArray, isNotNull, like, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  businesses,
  leads,
  LEAD_STATUSES,
  WEBSITE_CLASSES,
  type LeadStatus,
  type WebsiteClass,
} from "@/lib/db/schema";
import { DEFAULT_SORT_DIR, LEAD_SORTS, type LeadSort, type SortDir } from "./sort";

export * from "./sort";

export type LeadFilters = {
  status: LeadStatus[];
  websiteClass: WebsiteClass[];
  category?: string;
  area?: string;
  hasPhone: boolean;
  minRating?: number;
  minReviews?: number;
  search?: string;
  sort: LeadSort;
  dir: SortDir;
};

export const DEFAULT_FILTERS: LeadFilters = {
  status: [],
  websiteClass: [],
  hasPhone: false,
  sort: "score",
  dir: "desc",
};

function pickAll<T extends string>(raw: string[] | undefined, allowed: readonly T[]): T[] {
  if (!raw?.length) return [];
  return raw.filter((value): value is T => (allowed as readonly string[]).includes(value));
}

/** Read filters out of the URL so the leads page is shareable and bookmarkable. */
export function parseLeadFilters(params: URLSearchParams): LeadFilters {
  const sortParam = params.get("sort");
  const sort: LeadSort = LEAD_SORTS.includes(sortParam as LeadSort)
    ? (sortParam as LeadSort)
    : "score";

  const dirParam = params.get("dir");
  const dir: SortDir =
    dirParam === "asc" || dirParam === "desc" ? dirParam : DEFAULT_SORT_DIR[sort];

  const minRating = Number(params.get("minRating"));
  const minReviews = Number(params.get("minReviews"));

  return {
    status: pickAll(params.getAll("status"), LEAD_STATUSES),
    websiteClass: pickAll(params.getAll("websiteClass"), WEBSITE_CLASSES),
    category: params.get("category") || undefined,
    area: params.get("area") || undefined,
    hasPhone: params.get("hasPhone") === "1",
    minRating: Number.isFinite(minRating) && minRating > 0 ? minRating : undefined,
    minReviews: Number.isFinite(minReviews) && minReviews > 0 ? minReviews : undefined,
    search: params.get("q")?.trim() || undefined,
    sort,
    dir,
  };
}

function buildWhere(filters: LeadFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.status.length) conditions.push(inArray(leads.status, filters.status));
  if (filters.websiteClass.length) {
    conditions.push(inArray(businesses.websiteClass, filters.websiteClass));
  }
  if (filters.category) conditions.push(eq(businesses.primaryCategory, filters.category));
  if (filters.area) conditions.push(eq(businesses.areaName, filters.area));
  if (filters.hasPhone) conditions.push(isNotNull(businesses.phone));
  if (filters.minRating != null) conditions.push(gte(businesses.rating, filters.minRating));
  if (filters.minReviews != null) {
    conditions.push(gte(businesses.userRatingCount, filters.minReviews));
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    const match = or(like(businesses.name, term), like(businesses.address, term));
    if (match) conditions.push(match);
  }

  return conditions.length ? and(...conditions) : undefined;
}

function buildOrder(sort: LeadSort, dir: SortDir) {
  const by = dir === "asc" ? asc : desc;

  const primary = {
    score: businesses.leadScore,
    name: businesses.name,
    category: businesses.primaryCategory,
    why: businesses.websiteClass,
    reviews: businesses.userRatingCount,
    rating: businesses.rating,
    quote: leads.quoteAmount,
    status: leads.status,
    recent: leads.createdAt,
  }[sort];

  // A stable tiebreaker on a unique column. Without one, rows that tie on the
  // sort column can come back in a different order per query, which makes
  // paging silently drop and repeat leads between pages.
  return [by(primary), desc(businesses.leadScore), asc(leads.id)];
}

const leadColumns = {
  leadId: leads.id,
  status: leads.status,
  quoteAmount: leads.quoteAmount,
  currency: leads.currency,
  demoUrl: leads.demoUrl,
  notes: leads.notes,
  contactedAt: leads.contactedAt,
  nextFollowUpAt: leads.nextFollowUpAt,
  createdAt: leads.createdAt,
  businessId: businesses.id,
  placeId: businesses.placeId,
  name: businesses.name,
  address: businesses.address,
  lat: businesses.lat,
  lng: businesses.lng,
  phone: businesses.phone,
  websiteUri: businesses.websiteUri,
  websiteHost: businesses.websiteHost,
  websiteClass: businesses.websiteClass,
  websiteStatus: businesses.websiteStatus,
  rating: businesses.rating,
  userRatingCount: businesses.userRatingCount,
  leadScore: businesses.leadScore,
  category: businesses.primaryCategory,
  areaName: businesses.areaName,
} as const;

export type LeadRow = {
  [K in keyof typeof leadColumns]: (typeof leadColumns)[K]["_"]["data"];
};

export async function queryLeads(
  filters: LeadFilters,
  limit = 50,
  offset = 0,
): Promise<LeadRow[]> {
  return (await db
    .select(leadColumns)
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(buildWhere(filters))
    .orderBy(...buildOrder(filters.sort, filters.dir))
    .limit(limit)
    .offset(offset)) as LeadRow[];
}

/**
 * Totals for the current filter, not the whole database. The strip above the
 * table has to describe what you are actually looking at, or narrowing to one
 * category tells you nothing about that category.
 *
 * Every aggregate is cast explicitly. Postgres returns `count`/`sum` as
 * `bigint` and `numeric`, which the driver hands back as *strings* to avoid
 * losing precision — without the casts these arrive as "808" and quietly break
 * every bit of arithmetic downstream.
 */
export async function summarizeLeads(filters: LeadFilters) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withPhone: sql<number>`count(*) filter (where ${businesses.phone} is not null)::int`,
      untouched: sql<number>`count(*) filter (where ${leads.status} = 'new')::int`,
      inPlay: sql<number>`count(*) filter (where ${leads.status} in ('qualified','demo_built','contacted','negotiating'))::int`,
      won: sql<number>`count(*) filter (where ${leads.status} = 'won')::int`,
      pipelineValue: sql<number>`coalesce(sum(${leads.quoteAmount}) filter (where ${leads.status} in ('demo_built','contacted','negotiating')), 0)::float`,
      avgScore: sql<number>`coalesce(avg(${businesses.leadScore}), 0)::float`,
    })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(buildWhere(filters));

  return {
    total: row?.total ?? 0,
    withPhone: row?.withPhone ?? 0,
    untouched: row?.untouched ?? 0,
    inPlay: row?.inPlay ?? 0,
    won: row?.won ?? 0,
    pipelineValue: row?.pipelineValue ?? 0,
    avgScore: Math.round(row?.avgScore ?? 0),
  };
}

export async function countLeads(filters: LeadFilters): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(buildWhere(filters));

  return row?.count ?? 0;
}

export async function getLead(leadId: number): Promise<LeadRow | undefined> {
  const [row] = await db
    .select(leadColumns)
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(eq(leads.id, leadId))
    .limit(1);

  return row as LeadRow | undefined;
}

/** Distinct values present in the data, for populating filter dropdowns. */
export async function filterOptions() {
  const pluck = (rows: { value: string | null }[]) =>
    rows
      .map((r) => r.value)
      .filter((v): v is string => Boolean(v))
      .sort();

  const [categories, areas] = await Promise.all([
    db
      .selectDistinct({ value: businesses.primaryCategory })
      .from(businesses)
      .innerJoin(leads, eq(leads.businessId, businesses.id)),
    db
      .selectDistinct({ value: businesses.areaName })
      .from(businesses)
      .innerJoin(leads, eq(leads.businessId, businesses.id)),
  ]);

  return { categories: pluck(categories), areas: pluck(areas) };
}
