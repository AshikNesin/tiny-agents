CREATE TABLE `vault_values` (
	`id` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`policy` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `secret_item_id` text;