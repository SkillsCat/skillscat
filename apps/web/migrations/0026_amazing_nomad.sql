CREATE TABLE `skill_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`bundle_exact_fingerprint` text NOT NULL,
	`bundle_semantic_fingerprint` text,
	`skill_md_blob_sha` text,
	`skill_md_normalized_sha256` text,
	`canonical_source_id` text,
	`canonical_skill_id` text,
	`canonical_slug` text,
	`canonical_repo_owner` text,
	`canonical_repo_name` text,
	`canonical_skill_path` text,
	`canonical_version_id` text,
	`canonical_commit_sha` text,
	`canonical_commit_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_snapshots_bundle_exact_fingerprint_unique` ON `skill_snapshots` (`bundle_exact_fingerprint`);--> statement-breakpoint
CREATE INDEX `skill_snapshots_semantic_fingerprint_idx` ON `skill_snapshots` (`bundle_semantic_fingerprint`);--> statement-breakpoint
CREATE INDEX `skill_snapshots_blob_sha_idx` ON `skill_snapshots` (`skill_md_blob_sha`);--> statement-breakpoint
CREATE INDEX `skill_snapshots_canonical_source_idx` ON `skill_snapshots` (`canonical_source_id`);--> statement-breakpoint
CREATE INDEX `skill_snapshots_canonical_skill_idx` ON `skill_snapshots` (`canonical_skill_id`);--> statement-breakpoint
CREATE INDEX `skill_snapshots_canonical_commit_idx` ON `skill_snapshots` (`canonical_commit_at`);--> statement-breakpoint
CREATE TABLE `skill_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`skill_path` text DEFAULT '' NOT NULL,
	`visible_skill_id` text,
	`current_snapshot_id` text,
	`current_commit_sha` text,
	`latest_version_id` text,
	`lineage_root_snapshot_id` text,
	`history_state` text DEFAULT 'pending' NOT NULL,
	`history_cursor` text,
	`next_history_backfill_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_sources_repo_path_unique` ON `skill_sources` (`repo_owner`,`repo_name`,`skill_path`);--> statement-breakpoint
CREATE INDEX `skill_sources_visible_skill_idx` ON `skill_sources` (`visible_skill_id`);--> statement-breakpoint
CREATE INDEX `skill_sources_current_snapshot_idx` ON `skill_sources` (`current_snapshot_id`);--> statement-breakpoint
CREATE INDEX `skill_sources_latest_version_idx` ON `skill_sources` (`latest_version_id`);--> statement-breakpoint
CREATE INDEX `skill_sources_lineage_root_snapshot_idx` ON `skill_sources` (`lineage_root_snapshot_id`);--> statement-breakpoint
CREATE INDEX `skill_sources_history_backfill_idx` ON `skill_sources` (`next_history_backfill_at`,`id`);--> statement-breakpoint
CREATE TABLE `skill_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`previous_version_id` text,
	`commit_sha` text NOT NULL,
	`commit_at` integer,
	`version_started_at` integer,
	`indexed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`relation_type` text DEFAULT 'canonical' NOT NULL,
	`is_provisional` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_versions_source_commit_unique` ON `skill_versions` (`source_id`,`commit_sha`);--> statement-breakpoint
CREATE INDEX `skill_versions_source_idx` ON `skill_versions` (`source_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `skill_versions_snapshot_idx` ON `skill_versions` (`snapshot_id`,`version_started_at`);--> statement-breakpoint
CREATE INDEX `skill_versions_previous_idx` ON `skill_versions` (`previous_version_id`);--> statement-breakpoint
ALTER TABLE `skills` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `current_snapshot_id` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `current_version_id` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_skill_id` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_slug` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_repo_owner` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_repo_name` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_skill_path` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_commit_sha` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `origin_relation_type` text;--> statement-breakpoint
CREATE INDEX `skills_source_idx` ON `skills` (`source_id`);--> statement-breakpoint
CREATE INDEX `skills_current_snapshot_idx` ON `skills` (`current_snapshot_id`);--> statement-breakpoint
CREATE INDEX `skills_current_version_idx` ON `skills` (`current_version_id`);--> statement-breakpoint
CREATE INDEX `skills_origin_skill_idx` ON `skills` (`origin_skill_id`);--> statement-breakpoint
CREATE INDEX `skills_origin_slug_idx` ON `skills` (`origin_slug`);