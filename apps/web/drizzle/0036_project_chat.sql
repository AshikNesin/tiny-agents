ALTER TABLE `bots` ADD `project_id` text REFERENCES code_projects(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `bots_project_id_unique` ON `bots` (`project_id`);