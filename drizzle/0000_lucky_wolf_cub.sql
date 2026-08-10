CREATE TABLE `businesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`lat` real,
	`lng` real,
	`types` text,
	`primary_category` text,
	`phone` text,
	`website_uri` text,
	`website_host` text,
	`rating` real,
	`user_rating_count` integer,
	`business_status` text,
	`website_class` text NOT NULL,
	`website_status` text DEFAULT 'unchecked' NOT NULL,
	`website_status_code` integer,
	`website_checked_at` integer,
	`lead_score` integer DEFAULT 0 NOT NULL,
	`area_name` text,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_place_id_idx` ON `businesses` (`place_id`);--> statement-breakpoint
CREATE INDEX `businesses_website_class_idx` ON `businesses` (`website_class`);--> statement-breakpoint
CREATE INDEX `businesses_category_idx` ON `businesses` (`primary_category`);--> statement-breakpoint
CREATE INDEX `businesses_area_idx` ON `businesses` (`area_name`);--> statement-breakpoint
CREATE INDEX `businesses_score_idx` ON `businesses` (`lead_score`);--> statement-breakpoint
CREATE TABLE `lead_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lead_id` integer NOT NULL,
	`type` text NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lead_events_lead_id_idx` ON `lead_events` (`lead_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`business_id` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`quote_amount` real,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`demo_url` text,
	`notes` text,
	`contacted_at` integer,
	`next_follow_up_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_business_id_idx` ON `leads` (`business_id`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_follow_up_idx` ON `leads` (`next_follow_up_at`);--> statement-breakpoint
CREATE TABLE `scrape_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`area_name` text NOT NULL,
	`params` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cells_total` integer DEFAULT 0 NOT NULL,
	`cells_done` integer DEFAULT 0 NOT NULL,
	`requests_made` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`businesses_found` integer DEFAULT 0 NOT NULL,
	`new_businesses` integer DEFAULT 0 NOT NULL,
	`leads_created` integer DEFAULT 0 NOT NULL,
	`saturated_cells` integer DEFAULT 0 NOT NULL,
	`stopped_reason` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scrape_jobs_status_idx` ON `scrape_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
