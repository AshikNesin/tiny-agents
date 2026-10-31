CREATE INDEX `kv_expires_at_idx` ON `kv` (`expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_completed_at_idx` ON `jobs` (`state`,`completed_at`);