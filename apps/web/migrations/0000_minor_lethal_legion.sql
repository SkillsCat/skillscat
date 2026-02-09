CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`org_id` text,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scopes` text DEFAULT '["read"]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_org_idx` ON `api_tokens` (`org_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_hash_idx` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`bio` text,
	`type` text,
	`user_id` text,
	`skills_count` integer DEFAULT 0,
	`total_stars` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_github_id_unique` ON `authors` (`github_id`);--> statement-breakpoint
CREATE INDEX `authors_username_idx` ON `authors` (`username`);--> statement-breakpoint
CREATE INDEX `authors_user_id_idx` ON `authors` (`user_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'predefined' NOT NULL,
	`parent_section` text,
	`suggested_by_skill_id` text,
	`skill_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`suggested_by_skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE INDEX `categories_type_idx` ON `categories` (`type`);--> statement-breakpoint
CREATE INDEX `categories_slug_idx` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `cli_auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`callback_url` text NOT NULL,
	`state` text NOT NULL,
	`auth_code` text,
	`user_id` text,
	`scopes` text DEFAULT '["read","write","publish"]' NOT NULL,
	`client_info` text,
	`code_challenge` text,
	`code_challenge_method` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cli_auth_sessions_status_idx` ON `cli_auth_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `content_hashes` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`hash_type` text NOT NULL,
	`hash_value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_hashes_unique_idx` ON `content_hashes` (`skill_id`,`hash_type`);--> statement-breakpoint
CREATE INDEX `content_hashes_lookup_idx` ON `content_hashes` (`hash_type`,`hash_value`);--> statement-breakpoint
CREATE TABLE `device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`scopes` text DEFAULT '["read","write","publish"]' NOT NULL,
	`client_info` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`authorized_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_codes_device_code_unique` ON `device_codes` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_codes_user_code_unique` ON `device_codes` (`user_code`);--> statement-breakpoint
CREATE INDEX `device_codes_device_code_idx` ON `device_codes` (`device_code`);--> statement-breakpoint
CREATE INDEX `device_codes_user_code_idx` ON `device_codes` (`user_code`);--> statement-breakpoint
CREATE INDEX `device_codes_status_idx` ON `device_codes` (`status`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `skill_id`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`metadata` text,
	`read` integer DEFAULT false NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`invited_by` text,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`display_name` text,
	`description` text,
	`avatar_url` text,
	`github_org_id` integer,
	`verified_at` integer,
	`owner_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_name_unique` ON `organizations` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE INDEX `organizations_owner_idx` ON `organizations` (`owner_id`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`access_token_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_token_hash_unique` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_hash_idx` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `skill_categories` (
	`skill_id` text NOT NULL,
	`category_slug` text NOT NULL,
	PRIMARY KEY(`skill_id`, `category_slug`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_categories_category_idx` ON `skill_categories` (`category_slug`);--> statement-breakpoint
CREATE TABLE `skill_permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`grantee_type` text NOT NULL,
	`grantee_id` text NOT NULL,
	`permission` text DEFAULT 'read' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_permissions_unique_idx` ON `skill_permissions` (`skill_id`,`grantee_type`,`grantee_id`);--> statement-breakpoint
CREATE INDEX `skill_permissions_skill_idx` ON `skill_permissions` (`skill_id`);--> statement-breakpoint
CREATE INDEX `skill_permissions_grantee_idx` ON `skill_permissions` (`grantee_type`,`grantee_id`);--> statement-breakpoint
CREATE TABLE `skill_tags` (
	`skill_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`skill_id`, `tag`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skill_tags_tag_idx` ON `skill_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`github_url` text,
	`repo_owner` text,
	`repo_name` text,
	`skill_path` text,
	`stars` integer DEFAULT 0,
	`forks` integer DEFAULT 0,
	`star_snapshots` text,
	`trending_score` real DEFAULT 0,
	`file_structure` text,
	`commit_sha` text,
	`readme` text,
	`last_commit_at` integer,
	`visibility` text DEFAULT 'public' NOT NULL,
	`owner_id` text,
	`org_id` text,
	`source_type` text DEFAULT 'github' NOT NULL,
	`content_hash` text,
	`verified_repo_url` text,
	`tier` text DEFAULT 'cold' NOT NULL,
	`last_accessed_at` integer,
	`access_count_7d` integer DEFAULT 0 NOT NULL,
	`access_count_30d` integer DEFAULT 0 NOT NULL,
	`next_update_at` integer,
	`download_count_7d` integer DEFAULT 0 NOT NULL,
	`download_count_30d` integer DEFAULT 0 NOT NULL,
	`classification_method` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`indexed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `skills_slug_idx` ON `skills` (`slug`);--> statement-breakpoint
CREATE INDEX `skills_trending_idx` ON `skills` (`trending_score`);--> statement-breakpoint
CREATE INDEX `skills_stars_idx` ON `skills` (`stars`);--> statement-breakpoint
CREATE INDEX `skills_indexed_idx` ON `skills` (`indexed_at`);--> statement-breakpoint
CREATE INDEX `skills_visibility_idx` ON `skills` (`visibility`);--> statement-breakpoint
CREATE INDEX `skills_owner_idx` ON `skills` (`owner_id`);--> statement-breakpoint
CREATE INDEX `skills_content_hash_idx` ON `skills` (`content_hash`);--> statement-breakpoint
CREATE INDEX `skills_tier_idx` ON `skills` (`tier`);--> statement-breakpoint
CREATE INDEX `skills_next_update_idx` ON `skills` (`next_update_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `skills_repo_path_unique` ON `skills` (`repo_owner`,`repo_name`,`skill_path`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`skill_id` text,
	`action_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_actions_skill_idx` ON `user_actions` (`skill_id`);--> statement-breakpoint
CREATE INDEX `user_actions_user_idx` ON `user_actions` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_actions_action_created_idx` ON `user_actions` (`action_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_actions_action_skill_created_idx` ON `user_actions` (`action_type`,`skill_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
