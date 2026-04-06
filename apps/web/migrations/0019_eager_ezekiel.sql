CREATE TABLE `skill_daily_metrics` (
	`skill_id` text NOT NULL,
	`metric_date` text NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`install_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`skill_id`, `metric_date`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_daily_metrics_date_idx` ON `skill_daily_metrics` (`metric_date`);--> statement-breakpoint
CREATE INDEX `skill_daily_metrics_skill_date_idx` ON `skill_daily_metrics` (`skill_id`,`metric_date`);