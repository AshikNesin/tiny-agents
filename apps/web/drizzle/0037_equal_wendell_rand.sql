DROP INDEX `jobs_singleton_active_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_singleton_idx` ON `jobs` (`name`,`singleton_key`) WHERE "jobs"."state" IN ('created', 'active');--> statement-breakpoint
ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `token_version` integer DEFAULT 0 NOT NULL;