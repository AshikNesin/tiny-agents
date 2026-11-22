CREATE TABLE `code_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`path` text NOT NULL,
	`line` integer NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`head_sha` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `code_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_findings_review_idx` ON `code_findings` (`review_id`,`state`);--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `brief` text;--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `reviewing_since` integer;