CREATE TABLE `bot_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`title` text,
	`last_message_preview` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_chats_conversation_id_unique` ON `bot_chats` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `bot_chats_bot_id_ended_at_idx` ON `bot_chats` (`bot_id`,`ended_at`);--> statement-breakpoint
CREATE TABLE `bot_connections` (
	`bot_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bot_id`, `connection_id`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bot_connections_connection_id_idx` ON `bot_connections` (`connection_id`);--> statement-breakpoint
CREATE TABLE `bot_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`from_bot_id` text,
	`to_bot_id` text NOT NULL,
	`reply_to_bot_id` text,
	`kind` text NOT NULL,
	`request_id` text NOT NULL,
	`source_key` text,
	`text` text NOT NULL,
	`delivered_at` integer,
	`answered_at` integer,
	`answer_reply_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_to_bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_messages_request_id_unique` ON `bot_messages` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bot_messages_source_key_unique` ON `bot_messages` (`source_key`);--> statement-breakpoint
CREATE INDEX `bot_messages_to_bot_id_answered_at_idx` ON `bot_messages` (`to_bot_id`,`answered_at`);--> statement-breakpoint
CREATE INDEX `bot_messages_reply_to_bot_id_answered_at_idx` ON `bot_messages` (`reply_to_bot_id`,`answered_at`);--> statement-breakpoint
CREATE TABLE `bot_skills` (
	`bot_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bot_id`, `skill_id`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bot_skills_skill_id_idx` ON `bot_skills` (`skill_id`);--> statement-breakpoint
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`model_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`chat_started_at` integer NOT NULL,
	`last_read_at` integer,
	`last_activity_at` integer NOT NULL,
	`last_message_preview` text,
	`tool_permissions` text DEFAULT '{}' NOT NULL,
	`memory_enabled` integer DEFAULT true NOT NULL,
	`auto_review` integer DEFAULT false NOT NULL,
	`memory_captured_through` integer,
	`pinned_at` integer,
	`browser_profile` text DEFAULT 'shared' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bots_conversation_id_unique` ON `bots` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`url` text NOT NULL,
	`transport` text DEFAULT 'streamable-http' NOT NULL,
	`auth_type` text DEFAULT 'none' NOT NULL,
	`header_name` text,
	`secret_enc` text,
	`oauth_enc` text,
	`tools_cache` text DEFAULT '[]' NOT NULL,
	`disabled_tools` text DEFAULT '[]' NOT NULL,
	`secret_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_slug_unique` ON `connections` (`slug`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`text` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'capture' NOT NULL,
	`confidence` real,
	`until` integer,
	`superseded_by_id` text,
	`superseded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memories_bot_id_status_category_idx` ON `memories` (`bot_id`,`status`,`category`);--> statement-breakpoint
CREATE TABLE `routine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`scheduled_for` integer NOT NULL,
	`status` text NOT NULL,
	`trigger` text DEFAULT 'schedule' NOT NULL,
	`request_id` text NOT NULL,
	`submitted_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`output` text,
	`error` text,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routine_runs_request_id_unique` ON `routine_runs` (`request_id`);--> statement-breakpoint
CREATE INDEX `routine_runs_status_idx` ON `routine_runs` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `routine_runs_routine_id_scheduled_for_unique` ON `routine_runs` (`routine_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`pending_job_id` text,
	`source_key` text,
	`conversation_id` text,
	`blocked_streak` integer DEFAULT 0 NOT NULL,
	`paused_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `routines_pending_job_id_unique` ON `routines` (`pending_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `routines_source_key_unique` ON `routines` (`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `routines_conversation_id_unique` ON `routines` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `routines_enabled_next_run_at_idx` ON `routines` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`files` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_name_unique` ON `skills` (`name`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_at` integer,
	`completed_at` integer,
	`source_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_key_unique` ON `tasks` (`source_key`);--> statement-breakpoint
CREATE INDEX `tasks_status_due_at_idx` ON `tasks` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`model_key` text,
	`storage_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`sha256` text,
	`extract_status` text DEFAULT 'none' NOT NULL,
	`extract_error` text,
	`extract_meta` text,
	`extracted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_storage_key_unique` ON `uploads` (`storage_key`);--> statement-breakpoint
CREATE TABLE `vault_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`item_id` text,
	`handle` text NOT NULL,
	`bot_id` text,
	`conversation_id` integer,
	`task_id` integer,
	`tool` text NOT NULL,
	`target` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	`unattended` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vault_audit_events_item_id_at_idx` ON `vault_audit_events` (`item_id`,`at`);--> statement-breakpoint
CREATE INDEX `vault_audit_events_at_idx` ON `vault_audit_events` (`at`);--> statement-breakpoint
CREATE TABLE `vault_items` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`kind` text NOT NULL,
	`backend` text NOT NULL,
	`external_id` text NOT NULL,
	`field` text,
	`label` text NOT NULL,
	`username` text,
	`origins_json` text DEFAULT '[]' NOT NULL,
	`hosts_json` text DEFAULT '[]' NOT NULL,
	`inject_json` text,
	`tools_json` text DEFAULT '[]' NOT NULL,
	`bots_json` text,
	`approval` text DEFAULT 'per_conversation' NOT NULL,
	`allow_unattended` integer DEFAULT false NOT NULL,
	`when_to_use` text,
	`card_meta_json` text,
	`has_totp` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`last_used_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vault_items_handle_unique` ON `vault_items` (`handle`);--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`category` text NOT NULL,
	`channel` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`bot_id` text,
	`title` text NOT NULL,
	`url` text,
	`priority` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`provider_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `notification_log_dedupe_key_created_at_idx` ON `notification_log` (`dedupe_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_log_created_at_idx` ON `notification_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` blob NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text DEFAULT '[]' NOT NULL,
	`credential_name` text,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkeys_credential_id_unique` ON `passkeys` (`credential_id`);--> statement-breakpoint
CREATE INDEX `passkeys_user_id_idx` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`job_name` text,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_logs_job_id_idx` ON `job_logs` (`job_id`);--> statement-breakpoint
CREATE TABLE `job_schedules` (
	`name` text PRIMARY KEY NOT NULL,
	`cron` text NOT NULL,
	`data` text,
	`timezone` text,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text,
	`state` text DEFAULT 'created' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`retry_limit` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`retry_delay` integer DEFAULT 0 NOT NULL,
	`run_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`output` text,
	`error` text,
	`singleton_key` text
);
--> statement-breakpoint
CREATE INDEX `jobs_state_run_at_idx` ON `jobs` (`state`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_name_idx` ON `jobs` (`name`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);