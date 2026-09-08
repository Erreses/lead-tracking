CREATE TABLE "site_builds" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" integer NOT NULL,
	"lead_id" integer,
	"slug" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"details_json" text,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"agent_log" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_builds" ADD CONSTRAINT "site_builds_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_builds" ADD CONSTRAINT "site_builds_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_builds_business_idx" ON "site_builds" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "site_builds_created_at_idx" ON "site_builds" USING btree ("created_at");