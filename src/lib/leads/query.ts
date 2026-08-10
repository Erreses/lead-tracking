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

export type LeadSort = "score" | "reviews" | "rating" | "name" | "recent";

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
};

export const DEFAULT_FILTERS: LeadFilters = {
  status: [],
  websiteClass: [],
  hasPhone: false,
  sort: "score",
};

function pickAll<T extends string>(raw: string[] | undefined, allowed: readonly T[]): T[] {
  if (!raw?.length) return [];
  return raw.filter((value): value is T => (allowed as readonly string[]).includes(value));
}

/** Read filters out of the URL so the leads page is shareable and bookmarkable. */
export function parseLeadFilters(params: URLSearchParams): LeadFilters {
  const sortParam = params.get("sort");
  const sort: LeadSort = (
    ["score", "reviews", "rating", "name", "recent"] as const
  ).includes(sortParam as LeadSort)
    ? (sortParam as LeadSort)
    : "score";

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

function buildOrder(sort: LeadSort) {
  switch (sort) {
    case "reviews":
      return [desc(businesses.userRatingCount), desc(businesses.leadScore)];
    case "rating":
      return [desc(businesses.rating), desc(businesses.userRatingCount)];
    case "name":
      return [asc(businesses.name)];
    case "recent":
      return [desc(leads.createdAt)];
    case "score":
    default:
      return [desc(businesses.leadScore), desc(businesses.userRatingCount)];
  }
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

export function queryLeads(filters: LeadFilters, limit = 50, offset = 0): LeadRow[] {
  return db
    .select(leadColumns)
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(buildWhere(filters))
    .orderBy(...buildOrder(filters.sort))
    .limit(limit)
    .offset(offset)
    .all() as LeadRow[];
}

export function countLeads(filters: LeadFilters): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(buildWhere(filters))
    .get();

  return row?.count ?? 0;
}

export function getLead(leadId: number): LeadRow | undefined {
  return db
    .select(leadColumns)
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(eq(leads.id, leadId))
    .get() as LeadRow | undefined;
}

/** Distinct values present in the data, for populating filter dropdowns. */
export function filterOptions() {
  const categories = db
    .selectDistinct({ value: businesses.primaryCategory })
    .from(businesses)
    .innerJoin(leads, eq(leads.businessId, businesses.id))
    .all()
    .map((r) => r.value)
    .filter((v): v is string => Boolean(v))
    .sort();

  const areas = db
    .selectDistinct({ value: businesses.areaName })
    .from(businesses)
    .innerJoin(leads, eq(leads.businessId, businesses.id))
    .all()
    .map((r) => r.value)
    .filter((v): v is string => Boolean(v))
    .sort();

  return { categories, areas };
}
