INSERT OR IGNORE INTO `code_threads` (`id`, `instance_id`, `native_id`, `followed`, `seen_cursor`, `created_at`, `updated_at`) SELECT 'shelley:' || `conversation_id`, 'shelley', `conversation_id`, 1, `last_seen_sequence_id`, `updated_at`, `updated_at` FROM `shelley_seen`;--> statement-breakpoint
INSERT OR IGNORE INTO `code_handoffs` (`id`, `bot_id`, `thread_id`, `title`, `task`, `cwd`, `idempotency_key`, `status`, `created_at`, `finished_at`) SELECT `id`, `bot_id`, 'shelley:' || `shelley_conversation_id`, `slug`, `task`, `cwd`, `idempotency_key`, CASE WHEN `status` IN ('starting', 'running', 'finished') THEN `status` ELSE 'finished' END, `created_at`, `finished_at` FROM `shelley_handoffs`;--> statement-breakpoint
DROP TABLE `shelley_handoffs`;--> statement-breakpoint
DROP TABLE `shelley_seen`;--> statement-breakpoint
ALTER TABLE `memories` DROP COLUMN `confidence`;
