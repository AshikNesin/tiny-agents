CREATE TABLE `prompt_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`prompt` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompt_revisions_bot_id_created_at_idx` ON `prompt_revisions` (`bot_id`,`created_at`);