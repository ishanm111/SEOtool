ALTER TABLE `clients` ADD `questionnaire_token` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `questionnaire_token_at` integer;
--> statement-breakpoint
ALTER TABLE `clients` ADD `questionnaire_answered_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_questionnaire_token_idx` ON `clients` (`questionnaire_token`);
