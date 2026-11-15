CREATE TABLE `code_autofix_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_id` text NOT NULL,
	`trigger` text NOT NULL,
	`state_hash` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`start_sha` text,
	`pushed_sha` text,
	`outcome` text,
	`detail` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`pull_id`) REFERENCES `code_pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_autofix_passes_hash_idx` ON `code_autofix_passes` (`pull_id`,`state_hash`);--> statement-breakpoint
CREATE INDEX `code_autofix_passes_pull_idx` ON `code_autofix_passes` (`pull_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `code_pr_comments` (
	`id` integer PRIMARY KEY NOT NULL,
	`pull_id` text NOT NULL,
	`pass_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pull_id`) REFERENCES `code_pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `code_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`transport` text DEFAULT 'gh' NOT NULL,
	`base_branch` text NOT NULL,
	`checkout_path` text NOT NULL,
	`default_instance_id` text,
	`default_model` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_projects_repo_idx` ON `code_projects` (`repo_owner`,`repo_name`);--> statement-breakpoint
CREATE TABLE `code_pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`url` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`head_ref` text NOT NULL,
	`head_sha` text,
	`base_ref` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`draft` integer DEFAULT true NOT NULL,
	`snapshot` text,
	`synced_at` integer,
	`autofix` integer DEFAULT false NOT NULL,
	`loop_status` text DEFAULT 'off' NOT NULL,
	`loop_reason` text,
	`loop_changed_at` integer,
	`loop_head_sha` text,
	`passes_without_owner` integer DEFAULT 0 NOT NULL,
	`owner_input_at` integer,
	`pending_job_id` text,
	`stalled_notified_sha` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `code_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_pull_requests_number_idx` ON `code_pull_requests` (`project_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `code_pull_requests_open_idx` ON `code_pull_requests` (`thread_id`) WHERE state = 'open';--> statement-breakpoint
CREATE INDEX `code_pull_requests_thread_idx` ON `code_pull_requests` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `code_review_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`path` text NOT NULL,
	`side` text DEFAULT 'new' NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`quote` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `code_review_drafts_thread_idx` ON `code_review_drafts` (`thread_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `code_review_viewed` (
	`thread_id` text NOT NULL,
	`path` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `path`)
);
--> statement-breakpoint
ALTER TABLE `code_threads` ADD `project_id` text REFERENCES code_projects(id);--> statement-breakpoint
ALTER TABLE `code_threads` ADD `branch` text;--> statement-breakpoint
ALTER TABLE `code_threads` ADD `base_sha` text;--> statement-breakpoint
ALTER TABLE `code_threads` ADD `worktree` text;--> statement-breakpoint
CREATE INDEX `code_threads_project_idx` ON `code_threads` (`project_id`);