CREATE TABLE `code_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`trigger` text NOT NULL,
	`workflow` text,
	`event` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`checkpoint_seq` integer,
	`report` text,
	`cost_usd` real,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `code_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_runs_seq_idx` ON `code_runs` (`thread_id`,`seq`);--> statement-breakpoint
ALTER TABLE `code_threads` ADD `role` text DEFAULT 'work' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_threads` ADD `attention` text;--> statement-breakpoint
CREATE UNIQUE INDEX `code_threads_native_idx` ON `code_threads` (`instance_id`,`native_id`);