CREATE TABLE "businesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"types" text,
	"primary_category" text,
	"phone" text,
	"website_uri" text,
	"website_host" text,
	"rating" double precision,
	"user_rating_count" integer,
	"business_status" text,
	"website_class" text NOT NULL,
	"website_status" text DEFAULT 'unchecked' NOT NULL,
	"website_status_code" integer,
	"website_checked_at" timestamp with time zone,
	"lead_score" integer DEFAULT 0 NOT NULL,
	"area_name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cell_coverage" (
	"id" serial PRIMARY KEY NOT NULL,
	"cell_key" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius" integer NOT NULL,
	"category_slug" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"places_found" integer DEFAULT 0 NOT NULL,
	"saturated" boolean DEFAULT false NOT NULL,
	"swept_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"quote_amount" double precision,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"demo_url" text,
	"notes" text,
	"contacted_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_name" text NOT NULL,
	"params" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cells_total" integer DEFAULT 0 NOT NULL,
	"cells_done" integer DEFAULT 0 NOT NULL,
	"requests_made" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"results_seen" integer DEFAULT 0 NOT NULL,
	"businesses_found" integer DEFAULT 0 NOT NULL,
	"new_businesses" integer DEFAULT 0 NOT NULL,
	"leads_created" integer DEFAULT 0 NOT NULL,
	"saturated_cells" integer DEFAULT 0 NOT NULL,
	"cells_skipped" integer DEFAULT 0 NOT NULL,
	"stopped_reason" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_place_id_idx" ON "businesses" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "businesses_website_class_idx" ON "businesses" USING btree ("website_class");--> statement-breakpoint
CREATE INDEX "businesses_category_idx" ON "businesses" USING btree ("primary_category");--> statement-breakpoint
CREATE INDEX "businesses_area_idx" ON "businesses" USING btree ("area_name");--> statement-breakpoint
CREATE INDEX "businesses_score_idx" ON "businesses" USING btree ("lead_score");--> statement-breakpoint
CREATE UNIQUE INDEX "cell_coverage_key_idx" ON "cell_coverage" USING btree ("cell_key");--> statement-breakpoint
CREATE INDEX "cell_coverage_swept_at_idx" ON "cell_coverage" USING btree ("swept_at");--> statement-breakpoint
CREATE INDEX "lead_events_lead_id_idx" ON "lead_events" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_business_id_idx" ON "leads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_follow_up_idx" ON "leads" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "scrape_jobs_status_idx" ON "scrape_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scrape_jobs_created_at_idx" ON "scrape_jobs" USING btree ("created_at");