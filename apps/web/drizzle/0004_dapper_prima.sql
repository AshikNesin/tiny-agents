CREATE TABLE `shelley_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`shelley_conversation_id` text NOT NULL,
	`slug` text,
	`task` text NOT NULL,
	`cwd` text,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shelley_handoffs_idempotency_key_unique` ON `shelley_handoffs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `shelley_handoffs_conversation_idx` ON `shelley_handoffs` (`shelley_conversation_id`);--> statement-breakpoint
CREATE INDEX `shelley_handoffs_bot_idx` ON `shelley_handoffs` (`bot_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `shelley_seen` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`last_seen_sequence_id` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
