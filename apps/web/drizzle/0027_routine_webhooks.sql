CREATE TABLE `routine_events` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL,
	`run_id` text,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routine_events_routine_id_run_id_idx` ON `routine_events` (`routine_id`,`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `routine_events_routine_id_delivery_id_unique` ON `routine_events` (`routine_id`,`delivery_id`);--> statement-breakpoint
ALTER TABLE `routines` ADD `hook_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `routines_hook_token_hash_unique` ON `routines` (`hook_token_hash`);