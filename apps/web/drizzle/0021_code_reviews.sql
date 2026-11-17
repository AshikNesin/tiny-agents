CREATE TABLE `code_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`head_ref` text NOT NULL,
	`base_ref` text NOT NULL,
	`head_sha` text NOT NULL,
	`from_fork` integer DEFAULT false NOT NULL,
	`worktree` text,
	`thread_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `code_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_reviews_pull_idx` ON `code_reviews` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `code_reviews_thread_idx` ON `code_reviews` (`thread_id`);