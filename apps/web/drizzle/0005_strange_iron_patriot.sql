CREATE TABLE `bot_guests` (
	`bot_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`last_read_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bot_id`, `user_id`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bot_guests_user_id_idx` ON `bot_guests` (`user_id`);--> statement-breakpoint
CREATE TABLE `guests` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
