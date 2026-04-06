CREATE TABLE `category_public_stats` (
	`category_slug` text PRIMARY KEY NOT NULL,
	`public_skill_count` integer DEFAULT 0 NOT NULL,
	`max_freshness_ts` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `categories_ai_suggested_skill_count_idx` ON `categories` (skill_count DESC,`slug`) WHERE "categories"."type" = 'ai-suggested' AND "categories"."skill_count" > 0;