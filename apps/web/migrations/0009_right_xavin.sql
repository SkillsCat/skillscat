CREATE INDEX `account_provider_account_idx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `favorites_user_created_idx` ON `favorites` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `skills_visibility_id_idx` ON `skills` (`visibility`,`id`);--> statement-breakpoint
CREATE INDEX `skills_owner_created_idx` ON `skills` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `skills_owner_visibility_stars_idx` ON `skills` (`owner_id`,`visibility`,`stars`);--> statement-breakpoint
CREATE INDEX `skills_org_visibility_stars_created_idx` ON `skills` (`org_id`,`visibility`,`stars`,`created_at`);--> statement-breakpoint
CREATE INDEX `skills_nonzero_download_counts_idx` ON `skills` (`id`) WHERE "skills"."download_count_7d" != 0 OR "skills"."download_count_30d" != 0 OR "skills"."download_count_90d" != 0;--> statement-breakpoint
CREATE INDEX `user_name_idx` ON `user` (`name`);