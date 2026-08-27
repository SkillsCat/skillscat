ALTER TABLE `account` ADD `issuer` text;--> statement-breakpoint
-- Backfill better-auth >= 1.7 account issuer: OAuth providers use `local:oauth:<providerId>`.
UPDATE `account` SET `issuer` = CASE WHEN `provider_id` = 'credential' THEN 'local:credential' ELSE 'local:oauth:' || `provider_id` END WHERE `issuer` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_account_idx` ON `account` (`issuer`,`account_id`);