CREATE TABLE `code_handoff_finishes` (
	`id` text PRIMARY KEY NOT NULL,
	`handoff_id` text NOT NULL,
	`request_id` text NOT NULL,
	`harness` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	FOREIGN KEY (`handoff_id`) REFERENCES `code_handoffs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_handoff_finishes_request_id_unique` ON `code_handoff_finishes` (`request_id`);--> statement-breakpoint
CREATE INDEX `code_handoff_finishes_delivered_idx` ON `code_handoff_finishes` (`delivered_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_code_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`thread_id` text,
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
INSERT INTO `__new_code_handoffs`("id", "bot_id", "thread_id", "title", "task", "cwd", "idempotency_key", "status", "created_at", "finished_at") SELECT "id", "bot_id", "thread_id", "title", "task", "cwd", "idempotency_key", "status", "created_at", "finished_at" FROM `code_handoffs`;--> statement-breakpoint
DROP TABLE `code_handoffs`;--> statement-breakpoint
ALTER TABLE `__new_code_handoffs` RENAME TO `code_handoffs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `code_handoffs_idempotency_key_unique` ON `code_handoffs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `code_handoffs_thread_idx` ON `code_handoffs` (`thread_id`);--> statement-breakpoint
CREATE INDEX `code_handoffs_bot_idx` ON `code_handoffs` (`bot_id`,`created_at`);