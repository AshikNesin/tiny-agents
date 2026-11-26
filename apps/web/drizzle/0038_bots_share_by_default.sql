ALTER TABLE `bot_connections` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `bot_skills` ADD `enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `all_bots` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `skills` ADD `all_bots` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `connections` SET `all_bots` = false;--> statement-breakpoint
UPDATE `skills` SET `all_bots` = false;--> statement-breakpoint
UPDATE `connections` SET `all_bots` = true WHERE EXISTS (SELECT 1 FROM `bots` b WHERE b.`project_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `bot_guests` g WHERE g.`bot_id` = b.`id`)) AND NOT EXISTS (SELECT 1 FROM `bots` b WHERE b.`project_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `bot_guests` g WHERE g.`bot_id` = b.`id`) AND NOT EXISTS (SELECT 1 FROM `bot_connections` l WHERE l.`bot_id` = b.`id` AND l.`connection_id` = `connections`.`id`));--> statement-breakpoint
UPDATE `skills` SET `all_bots` = true WHERE EXISTS (SELECT 1 FROM `bots` b WHERE b.`project_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `bot_guests` g WHERE g.`bot_id` = b.`id`)) AND NOT EXISTS (SELECT 1 FROM `bots` b WHERE b.`project_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `bot_guests` g WHERE g.`bot_id` = b.`id`) AND NOT EXISTS (SELECT 1 FROM `bot_skills` l WHERE l.`bot_id` = b.`id` AND l.`skill_id` = `skills`.`id`));--> statement-breakpoint
DELETE FROM `bot_connections` WHERE `connection_id` IN (SELECT `id` FROM `connections` WHERE `all_bots` = true) AND `bot_id` IN (SELECT b.`id` FROM `bots` b WHERE b.`project_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `bot_guests` g WHERE g.`bot_id` = b.`id`));--> statement-breakpoint
DELETE FROM `bot_skills` WHERE `skill_id` IN (SELECT `id` FROM `skills` WHERE `all_bots` = true) AND `bot_id` IN (SELECT b.`id` FROM `bots` b WHERE b.`project_id` IS NULL AND NOT EXISTS (SELECT 1 FROM `bot_guests` g WHERE g.`bot_id` = b.`id`));
