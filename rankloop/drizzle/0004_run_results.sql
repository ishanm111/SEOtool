CREATE TABLE `run_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`client_id` integer NOT NULL,
	`captured_at` integer,
	`answers_total` integer DEFAULT 0 NOT NULL,
	`answers_named` integer DEFAULT 0 NOT NULL,
	`named_pct` real DEFAULT 0 NOT NULL,
	`prompts_total` integer DEFAULT 0 NOT NULL,
	`pages_read` integer DEFAULT 0 NOT NULL,
	`wrong_geo_pages` integer DEFAULT 0 NOT NULL,
	`findings_total` integer DEFAULT 0 NOT NULL,
	`findings_critical` integer DEFAULT 0 NOT NULL,
	`recommendations_total` integer DEFAULT 0 NOT NULL,
	`recommendations_blocked` integer DEFAULT 0 NOT NULL,
	`competitors_total` integer DEFAULT 0 NOT NULL,
	`fixes_published` integer DEFAULT 0 NOT NULL,
	`gbp_rating` real,
	`gbp_review_count` integer,
	`report_path` text,
	`by_engine` text DEFAULT '[]' NOT NULL,
	`by_market` text DEFAULT '[]' NOT NULL,
	`top_competitors` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_results_run_idx` ON `run_results` (`run_id`);
--> statement-breakpoint
CREATE INDEX `run_results_client_idx` ON `run_results` (`client_id`);
