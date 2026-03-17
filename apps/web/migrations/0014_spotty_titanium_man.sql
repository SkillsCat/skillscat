CREATE TABLE `skill_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`reporter_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`source` text DEFAULT 'cli' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_reports_open_unique_idx` ON `skill_reports` (`skill_id`,`reporter_user_id`,`reason`) WHERE "skill_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX `skill_reports_skill_reason_status_idx` ON `skill_reports` (`skill_id`,`reason`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `skill_reports_reporter_idx` ON `skill_reports` (`reporter_user_id`,`reason`,`created_at`);--> statement-breakpoint
CREATE TABLE `skill_security_file_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`file_path` text NOT NULL,
	`file_kind` text NOT NULL,
	`source` text DEFAULT 'heuristic' NOT NULL,
	`dimension` text NOT NULL,
	`score` real NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `skill_security_scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_security_file_scores_unique_idx` ON `skill_security_file_scores` (`scan_id`,`file_path`,`dimension`,`source`);--> statement-breakpoint
CREATE INDEX `skill_security_file_scores_scan_file_idx` ON `skill_security_file_scores` (`scan_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `skill_security_file_scores_dimension_idx` ON `skill_security_file_scores` (`dimension`,`score`);--> statement-breakpoint
CREATE TABLE `skill_security_scan_dimensions` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`dimension` text NOT NULL,
	`score` real NOT NULL,
	`reason` text,
	`finding_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `skill_security_scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_security_scan_dimensions_unique_idx` ON `skill_security_scan_dimensions` (`scan_id`,`dimension`);--> statement-breakpoint
CREATE INDEX `skill_security_scan_dimensions_dimension_idx` ON `skill_security_scan_dimensions` (`dimension`,`score`);--> statement-breakpoint
CREATE TABLE `skill_security_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`content_fingerprint` text NOT NULL,
	`analysis_tier` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`provider` text,
	`model` text,
	`total_score` real,
	`risk_level` text,
	`summary` text,
	`findings` text,
	`rounds` integer DEFAULT 0 NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` real,
	`analyzed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_security_scans_unique_idx` ON `skill_security_scans` (`skill_id`,`content_fingerprint`,`analysis_tier`);--> statement-breakpoint
CREATE INDEX `skill_security_scans_skill_tier_idx` ON `skill_security_scans` (`skill_id`,`analysis_tier`,`analyzed_at`);--> statement-breakpoint
CREATE INDEX `skill_security_scans_level_idx` ON `skill_security_scans` (`risk_level`,`total_score`);--> statement-breakpoint
CREATE TABLE `skill_security_state` (
	`skill_id` text PRIMARY KEY NOT NULL,
	`content_fingerprint` text,
	`dirty` integer DEFAULT 1 NOT NULL,
	`next_update_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_analyzed_at` integer,
	`current_total_score` real,
	`current_risk_level` text,
	`current_free_scan_id` text,
	`current_premium_scan_id` text,
	`open_security_report_count` integer DEFAULT 0 NOT NULL,
	`report_risk_level` text DEFAULT 'low' NOT NULL,
	`premium_due_reason` text,
	`premium_requested_at` integer,
	`premium_requested_fingerprint` text,
	`premium_last_analyzed_fingerprint` text,
	`vt_eligibility` text DEFAULT 'unknown' NOT NULL,
	`vt_priority` integer DEFAULT 0 NOT NULL,
	`vt_bundle_sha256` text,
	`vt_bundle_size` integer,
	`vt_status` text DEFAULT 'pending' NOT NULL,
	`vt_analysis_id` text,
	`vt_last_stats` text,
	`vt_next_attempt_at` integer,
	`vt_last_attempt_at` integer,
	`vt_last_submitted_at` integer,
	`vt_last_completed_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_error_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_security_state_dirty_due_idx` ON `skill_security_state` (`dirty`,`next_update_at`);--> statement-breakpoint
CREATE INDEX `skill_security_state_status_due_idx` ON `skill_security_state` (`status`,`next_update_at`);--> statement-breakpoint
CREATE INDEX `skill_security_state_report_level_idx` ON `skill_security_state` (`report_risk_level`,`open_security_report_count`);--> statement-breakpoint
CREATE INDEX `skill_security_state_premium_due_idx` ON `skill_security_state` (`premium_due_reason`,`premium_requested_at`);--> statement-breakpoint
CREATE INDEX `skill_security_state_vt_due_idx` ON `skill_security_state` (`vt_status`,`vt_next_attempt_at`);--> statement-breakpoint
CREATE INDEX `skill_security_state_vt_priority_idx` ON `skill_security_state` (`vt_priority`,`vt_next_attempt_at`);--> statement-breakpoint
CREATE INDEX `skill_security_state_vt_sha_idx` ON `skill_security_state` (`vt_bundle_sha256`);