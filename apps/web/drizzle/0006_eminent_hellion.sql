CREATE TABLE `code_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`title` text,
	`task` text NOT NULL,
	`cwd` text,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_handoffs_idempotency_key_unique` ON `code_handoffs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `code_handoffs_thread_idx` ON `code_handoffs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `code_handoffs_bot_idx` ON `code_handoffs` (`bot_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `code_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`native_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`cwd` text,
	`parent_native_id` text,
	`model` text,
	`effort` text,
	`permission_mode` text,
	`archived` integer DEFAULT false NOT NULL,
	`followed` integer DEFAULT false NOT NULL,
	`seen_cursor` integer DEFAULT 0 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `code_threads_instance_idx` ON `code_threads` (`instance_id`,`updated_at`);