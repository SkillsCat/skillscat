CREATE INDEX `authors_sitemap_updated_partial_idx` ON `authors` (`updated_at`) WHERE "authors"."username" IS NOT NULL AND "authors"."skills_count" > 0;--> statement-breakpoint
CREATE INDEX `organizations_updated_idx` ON `organizations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `skills_visibility_org_idx` ON `skills` (`visibility`,`org_id`);