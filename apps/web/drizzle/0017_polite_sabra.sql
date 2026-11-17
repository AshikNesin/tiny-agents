ALTER TABLE `routine_runs` ADD `conversation_id` text;--> statement-breakpoint
ALTER TABLE `routine_runs` ADD `tokens` integer;--> statement-breakpoint
CREATE INDEX `routine_runs_conversation_id_idx` ON `routine_runs` (`conversation_id`);