CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`seq` integer NOT NULL,
	`op` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`content_sha256` text NOT NULL,
	`source_key` text,
	`author` text DEFAULT 'bot' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_versions_source_key_unique` ON `artifact_versions` (`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_versions_artifact_seq_unique` ON `artifact_versions` (`artifact_id`,`seq`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`language` text,
	`head_seq` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_bot_id_idx` ON `artifacts` (`bot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_conversation_slug_unique` ON `artifacts` (`conversation_id`,`slug`);