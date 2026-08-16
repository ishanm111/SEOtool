CREATE TABLE `citations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`is_client_domain` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`homepage_url` text NOT NULL,
	`business_type` text DEFAULT 'local_service' NOT NULL,
	`platform` text DEFAULT 'custom' NOT NULL,
	`api_base` text,
	`aliases` text DEFAULT '[]' NOT NULL,
	`phones` text DEFAULT '[]' NOT NULL,
	`primary_phone` text,
	`gbp_url` text,
	`gbp_rating` real,
	`gbp_review_count` integer,
	`gbp_has_website` integer,
	`gbp_service_area` text,
	`offerings` text DEFAULT '[]' NOT NULL,
	`wrong_geo_terms` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `competitive_bar` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`location_id` integer,
	`rank` integer DEFAULT 1 NOT NULL,
	`business_name` text NOT NULL,
	`rating` real,
	`review_count` integer,
	`source` text DEFAULT 'manual' NOT NULL,
	`captured_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`domain` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`citation_count` integer DEFAULT 0 NOT NULL,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`city_page_count` integer DEFAULT 0 NOT NULL,
	`city_pages` text DEFAULT '[]' NOT NULL,
	`schema_types` text DEFAULT '[]' NOT NULL,
	`has_local_business` integer DEFAULT false NOT NULL,
	`has_faq_schema` integer DEFAULT false NOT NULL,
	`faq_block_count` integer DEFAULT 0 NOT NULL,
	`avg_readability` real DEFAULT 0 NOT NULL,
	`stats_per_thousand` real DEFAULT 0 NOT NULL,
	`superlative_count` integer DEFAULT 0 NOT NULL,
	`sample_word_count` integer DEFAULT 0 NOT NULL,
	`phones` text DEFAULT '[]' NOT NULL,
	`discovered_via` text DEFAULT 'sitemap' NOT NULL,
	`is_national` integer DEFAULT false NOT NULL,
	`crawled_at` integer,
	`ok` integer DEFAULT true NOT NULL,
	`error` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer,
	`category` text NOT NULL,
	`severity` text DEFAULT 'medium' NOT NULL,
	`issue` text NOT NULL,
	`current_text` text,
	`proposed_text` text,
	`evidence` text,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `generated_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`location_id` integer,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`meta_description` text DEFAULT '' NOT NULL,
	`h1` text NOT NULL,
	`body_html` text NOT NULL,
	`schema_json` text DEFAULT '' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`name` text NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`metro` text DEFAULT '' NOT NULL,
	`dataforseo_location` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `mentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`business_name` text NOT NULL,
	`is_client` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`external_id` text,
	`url` text NOT NULL,
	`slug` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`meta_description` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`schema_types` text DEFAULT '[]' NOT NULL,
	`page_type` text DEFAULT 'page' NOT NULL,
	`geo_refs` text DEFAULT '[]' NOT NULL,
	`wrong_geo_hits` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `paragraphs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`heading` text DEFAULT '' NOT NULL,
	`text` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`stat_count` integer DEFAULT 0 NOT NULL,
	`has_citation` integer DEFAULT false NOT NULL,
	`superlative_count` integer DEFAULT 0 NOT NULL,
	`readability` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`location_id` integer,
	`text` text NOT NULL,
	`intent` text DEFAULT 'comparison' NOT NULL,
	`persona` text DEFAULT 'general' NOT NULL,
	`is_core` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`page_id` integer,
	`kind` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`current_value` text,
	`proposed_value` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`placeholder_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt_id` integer NOT NULL,
	`engine` text NOT NULL,
	`answer_text` text DEFAULT '' NOT NULL,
	`screenshot_path` text,
	`raw_payload` text,
	`ok` integer DEFAULT true NOT NULL,
	`error` text,
	`run_at` integer,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON UPDATE no action ON DELETE no action
);
