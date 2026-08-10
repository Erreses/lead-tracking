import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * How a business's "website" was judged. Everything except `has_website` counts
 * as a sellable lead — see `src/lib/leads/classify.ts`.
 */
export const WEBSITE_CLASSES = [
  "none",
  "google_site",
  "social_only",
  "aggregator_only",
  "builder_subdomain",
  "dead",
  "has_website",
] as const;
export type WebsiteClass = (typeof WEBSITE_CLASSES)[number];

/** Result of the optional website health probe. */
export const WEBSITE_STATUSES = ["unchecked", "ok", "dead", "error"] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

/** Sales pipeline, in the order a lead moves through it. */
export const LEAD_STATUSES = [
  "new",
  "qualified",
  "demo_built",
  "contacted",
  "negotiating",
  "won",
  "lost",
  "discarded",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * One row per Google place. `placeId` is the dedup key: re-scraping the same
 * area upserts these rows rather than creating duplicates.
 */
export const businesses = sqliteTable(
  "businesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    lat: real("lat"),
    lng: real("lng"),
    /** JSON array of the raw Google place types. */
    types: text("types"),
    /** Slug of the category preset that found this place. */
    primaryCategory: text("primary_category"),
    phone: text("phone"),
    websiteUri: text("website_uri"),
    /** Hostname pulled out of `websiteUri`, for display and filtering. */
    websiteHost: text("website_host"),
    rating: real("rating"),
    userRatingCount: integer("user_rating_count"),
    businessStatus: text("business_status"),
    websiteClass: text("website_class").$type<WebsiteClass>().notNull(),
    websiteStatus: text("website_status")
      .$type<WebsiteStatus>()
      .notNull()
      .default("unchecked"),
    websiteStatusCode: integer("website_status_code"),
    websiteCheckedAt: integer("website_checked_at", { mode: "timestamp_ms" }),
    /** 0-100 priority score, see `scoreLead`. */
    leadScore: integer("lead_score").notNull().default(0),
    areaName: text("area_name"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("businesses_place_id_idx").on(t.placeId),
    index("businesses_website_class_idx").on(t.websiteClass),
    index("businesses_category_idx").on(t.primaryCategory),
    index("businesses_area_idx").on(t.areaName),
    index("businesses_score_idx").on(t.leadScore),
  ],
);

/** A business worth selling to. One per business, created during a scrape. */
export const leads = sqliteTable(
  "leads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: text("status").$type<LeadStatus>().notNull().default("new"),
    quoteAmount: real("quote_amount"),
    currency: text("currency").notNull().default("EUR"),
    demoUrl: text("demo_url"),
    notes: text("notes"),
    contactedAt: integer("contacted_at", { mode: "timestamp_ms" }),
    nextFollowUpAt: integer("next_follow_up_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("leads_business_id_idx").on(t.businessId),
    index("leads_status_idx").on(t.status),
    index("leads_follow_up_idx").on(t.nextFollowUpAt),
  ],
);

/** Append-only activity timeline shown on the lead detail page. */
export const leadEvents = sqliteTable(
  "lead_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("lead_events_lead_id_idx").on(t.leadId)],
);

/** One row per "hit the Scrape button", tracking progress and spend. */
export const scrapeJobs = sqliteTable(
  "scrape_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    areaName: text("area_name").notNull(),
    /** JSON snapshot of the request that started this job. */
    params: text("params").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    cellsTotal: integer("cells_total").notNull().default(0),
    cellsDone: integer("cells_done").notNull().default(0),
    requestsMade: integer("requests_made").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    businessesFound: integer("businesses_found").notNull().default(0),
    newBusinesses: integer("new_businesses").notNull().default(0),
    leadsCreated: integer("leads_created").notNull().default(0),
    /** Cells still returning a full page at max depth — coverage may be partial. */
    saturatedCells: integer("saturated_cells").notNull().default(0),
    /** Set when the budget cap stopped the job early. */
    stoppedReason: text("stopped_reason"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("scrape_jobs_status_idx").on(t.status)],
);

/** Editable key/value config: default quote, outreach templates, domain lists. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
