import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema. Table and column names are unchanged from the SQLite version
 * this replaced, so the one-off data migration is a straight column-for-column
 * copy and every hand-written query still reads the same.
 *
 * Three type changes were forced by the move:
 *   - millisecond integers → real `timestamptz` values
 *   - 0/1 integers → real booleans
 *   - `autoincrement` → `serial`
 */

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

/**
 * Result of the optional website health probe.
 *
 * `blocked` means the server answered by refusing us — bot protection, an auth
 * wall, rate limiting. The site is up; we just couldn't see it. Kept separate
 * from `dead` because pitching someone that their working website is broken is
 * the most expensive mistake this tool can make.
 */
export const WEBSITE_STATUSES = ["unchecked", "ok", "dead", "blocked", "error"] as const;
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
 * Stored as `text` rather than a Postgres enum on purpose: adding a value to an
 * enum needs a migration and a lock, and these lists grow (`blocked` was added
 * to `WEBSITE_STATUSES` after a bug). The `$type<>()` keeps them honest in
 * TypeScript, which is where the mistakes actually happen.
 */

/**
 * One row per Google place. `placeId` is the dedup key: re-scraping the same
 * area upserts these rows rather than creating duplicates.
 */
export const businesses = pgTable(
  "businesses",
  {
    id: serial("id").primaryKey(),
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** JSON array of the raw Google place types. */
    types: text("types"),
    /** Slug of the category preset that found this place. */
    primaryCategory: text("primary_category"),
    phone: text("phone"),
    websiteUri: text("website_uri"),
    /** Hostname pulled out of `websiteUri`, for display and filtering. */
    websiteHost: text("website_host"),
    rating: doublePrecision("rating"),
    userRatingCount: integer("user_rating_count"),
    businessStatus: text("business_status"),
    websiteClass: text("website_class").$type<WebsiteClass>().notNull(),
    websiteStatus: text("website_status")
      .$type<WebsiteStatus>()
      .notNull()
      .default("unchecked"),
    websiteStatusCode: integer("website_status_code"),
    websiteCheckedAt: timestamp("website_checked_at", { withTimezone: true }),
    /** 0-100 priority score, see `scoreLead`. */
    leadScore: integer("lead_score").notNull().default(0),
    areaName: text("area_name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
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
export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: text("status").$type<LeadStatus>().notNull().default("new"),
    quoteAmount: doublePrecision("quote_amount"),
    currency: text("currency").notNull().default("EUR"),
    demoUrl: text("demo_url"),
    notes: text("notes"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_business_id_idx").on(t.businessId),
    index("leads_status_idx").on(t.status),
    index("leads_follow_up_idx").on(t.nextFollowUpAt),
  ],
);

/** Append-only activity timeline shown on the lead detail page. */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_events_lead_id_idx").on(t.leadId)],
);

/**
 * Rows written by `npm run seed:demo` carry this prefix in `areaName`. Demo jobs
 * report requests they never made, so anything that meters real API spend has to
 * filter them out.
 */
export const DEMO_AREA_PREFIX = "DEMO ·";

/** One row per "hit the Scrape button", tracking progress and spend. */
export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: serial("id").primaryKey(),
    areaName: text("area_name").notNull(),
    /** JSON snapshot of the request that started this job. */
    params: text("params").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    cellsTotal: integer("cells_total").notNull().default(0),
    cellsDone: integer("cells_done").notNull().default(0),
    requestsMade: integer("requests_made").notNull().default(0),
    estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull().default(0),
    /**
     * Places returned across every search, duplicates included. Cells overlap by
     * design and a business can match several categories, so this runs well
     * above `businessesFound` — it is what the requests actually bought, and
     * divided by `requestsMade` it says how full the pages were coming back.
     */
    resultsSeen: integer("results_seen").notNull().default(0),
    /** Distinct businesses this job saw, counted once each. */
    businessesFound: integer("businesses_found").notNull().default(0),
    newBusinesses: integer("new_businesses").notNull().default(0),
    leadsCreated: integer("leads_created").notNull().default(0),
    /** Cells still returning a full page at max depth — coverage may be partial. */
    saturatedCells: integer("saturated_cells").notNull().default(0),
    /** Searches skipped because `cell_coverage` had them swept recently. */
    cellsSkipped: integer("cells_skipped").notNull().default(0),
    /** Set when the budget cap stopped the job early. */
    stoppedReason: text("stopped_reason"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scrape_jobs_status_idx").on(t.status),
    // The free-tier meter sums this month's rows; without this it scans the lot.
    index("scrape_jobs_created_at_idx").on(t.createdAt),
  ],
);

/**
 * One row per cell × category that has actually been searched.
 *
 * Google bills per request and offers no way to say "skip the places I already
 * have", so the only way to spend less on a repeat sweep is to not issue the
 * request at all. This table is what makes that possible: a re-run of the same
 * area skips every pair swept inside the coverage window.
 */
export const cellCoverage = pgTable(
  "cell_coverage",
  {
    id: serial("id").primaryKey(),
    /** `lat:lng:radius:category`, rounded — see `src/lib/scrape/coverage.ts`. */
    cellKey: text("cell_key").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    radius: integer("radius").notNull(),
    categorySlug: text("category_slug").notNull(),
    /** 0 for the initial lattice, +1 for each subdivision. */
    depth: integer("depth").notNull().default(0),
    /** Places this search returned, before deduplication. */
    placesFound: integer("places_found").notNull().default(0),
    /** Hit Google's 60-result ceiling: coverage here may still be partial. */
    saturated: boolean("saturated").notNull().default(false),
    sweptAt: timestamp("swept_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cell_coverage_key_idx").on(t.cellKey),
    index("cell_coverage_swept_at_idx").on(t.sweptAt),
  ],
);

/** Editable key/value config: default quote, outreach templates, domain lists. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
