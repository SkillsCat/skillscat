ALTER TABLE `authors` ADD `type` text;--> statement-breakpoint
ALTER TABLE `authors` ADD `user_id` text;--> statement-breakpoint
CREATE INDEX `authors_user_id_idx` ON `authors` (`user_id`);