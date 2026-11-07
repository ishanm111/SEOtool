CREATE TABLE `portal_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT 0 NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`last_login_at` integer,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_users_email_unique` ON `portal_users` (`email`);
--> statement-breakpoint
ALTER TABLE `recommendations` ADD `client_decision` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `recommendations` ADD `decided_at` integer;
--> statement-breakpoint
ALTER TABLE `recommendations` ADD `decided_by` text;
