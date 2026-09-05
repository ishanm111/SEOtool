CREATE TABLE `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`step_keys` text DEFAULT '[]' NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pipeline_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`step_key` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`log` text DEFAULT '' NOT NULL,
	`exit_code` integer,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`kind` text NOT NULL,
	`endpoint` text DEFAULT '' NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`detail` text,
	`checked_at` integer,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fix_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`recommendation_id` integer,
	`page_id` integer,
	`target_url` text DEFAULT '' NOT NULL,
	`field` text DEFAULT '' NOT NULL,
	`previous_value` text,
	`applied_value` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`error` text,
	`applied_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_client_idx` ON `pipeline_runs` (`client_id`);
--> statement-breakpoint
CREATE INDEX `pipeline_steps_run_idx` ON `pipeline_steps` (`run_id`);
--> statement-breakpoint
CREATE INDEX `fix_applications_client_idx` ON `fix_applications` (`client_id`);
