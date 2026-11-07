CREATE TABLE `bot_releases` (
	`bot_id` text NOT NULL,
	`resource` text NOT NULL,
	`captured` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bot_id`, `resource`)
);
