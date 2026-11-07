CREATE TABLE `model_roles` (
	`role` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`upstream_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'chat' NOT NULL,
	`source` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`context_window` integer NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`image_input` integer NOT NULL,
	`reasoning` integer NOT NULL,
	`overrides_json` text DEFAULT '{}' NOT NULL,
	`compat_json` text,
	`missing_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_provider_upstream_idx` ON `models` (`provider_id`,`upstream_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text,
	`credential_item_id` text,
	`via_provider_id` text,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`discovery` text DEFAULT 'auto' NOT NULL,
	`allow_private_network` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'unchecked' NOT NULL,
	`status_detail` text,
	`checked_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`credential_item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`via_provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `bots` ADD `model_ref` text REFERENCES models(id);--> statement-breakpoint
ALTER TABLE `bots` DROP COLUMN `model_id`;