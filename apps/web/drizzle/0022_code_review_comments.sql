ALTER TABLE `code_review_drafts` ADD `target` text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE `code_reviews` ADD `mine` integer DEFAULT false NOT NULL;