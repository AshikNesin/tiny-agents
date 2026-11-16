CREATE TABLE `code_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`sha` text NOT NULL,
	`head_sha` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_checkpoints_seq_idx` ON `code_checkpoints` (`thread_id`,`seq`);--> statement-breakpoint
CREATE TABLE `code_pr_events` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`pull_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `code_autofix_passes` ADD `start_cost_usd` real;--> statement-breakpoint
ALTER TABLE `code_autofix_passes` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `code_projects` ADD `installation_id` integer;--> statement-breakpoint
ALTER TABLE `code_pull_requests` ADD `auto_merge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `code_threads` ADD `spend_limit_usd` real;