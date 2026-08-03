CREATE TABLE `skill_submissions` (
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`indexed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `skill_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_submissions_user_indexed_idx` ON `skill_submissions` (`user_id`,`indexed_at`,`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_submissions_skill_idx` ON `skill_submissions` (`skill_id`);