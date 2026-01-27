import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ========== Organizations ==========
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name'),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  githubOrgId: integer('github_org_id'),
  verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
  ownerId: text('owner_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('organizations_slug_idx').on(table.slug),
  index('organizations_owner_idx').on(table.ownerId)
]);

// ========== Organization Members ==========
export const orgMembers = sqliteTable('org_members', {
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('member'), // 'owner', 'admin', 'member'
  invitedBy: text('invited_by'),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.orgId, table.userId] }),
  index('org_members_user_idx').on(table.userId)
]);

// ========== Skills ==========
export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  githubUrl: text('github_url').unique(),
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
  skillPath: text('skill_path'),
  stars: integer('stars').default(0),
  forks: integer('forks').default(0),
  starSnapshots: text('star_snapshots'), // JSON: [{d, s}]
  trendingScore: real('trending_score').default(0),
  fileStructure: text('file_structure'), // JSON
  readme: text('readme'),
  lastCommitAt: integer('last_commit_at'),
  // New fields for private skills
  visibility: text('visibility').notNull().default('public'), // 'public', 'private', 'unlisted'
  ownerId: text('owner_id'), // Better Auth user ID
  orgId: text('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  sourceType: text('source_type').notNull().default('github'), // 'github', 'upload'
  contentHash: text('content_hash'), // SHA-256 hash for duplicate detection
  verifiedRepoUrl: text('verified_repo_url'), // For private-to-public conversion
  // Cost optimization: tiered update system
  tier: text('tier').notNull().default('cold'), // 'hot', 'warm', 'cool', 'cold', 'archived'
  lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp_ms' }),
  accessCount7d: integer('access_count_7d').notNull().default(0),
  accessCount30d: integer('access_count_30d').notNull().default(0),
  nextUpdateAt: integer('next_update_at', { mode: 'timestamp_ms' }),
  classificationMethod: text('classification_method'), // 'ai', 'keyword', 'skipped'
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('skills_slug_idx').on(table.slug),
  index('skills_trending_idx').on(table.trendingScore),
  index('skills_stars_idx').on(table.stars),
  index('skills_indexed_idx').on(table.indexedAt),
  index('skills_visibility_idx').on(table.visibility),
  index('skills_owner_idx').on(table.ownerId),
  index('skills_content_hash_idx').on(table.contentHash),
  // Cost optimization indexes
  index('skills_tier_idx').on(table.tier),
  index('skills_next_update_idx').on(table.nextUpdateAt),
  // Unique constraint for multi-skill repos (same repo can have multiple skills with different paths)
  uniqueIndex('skills_repo_path_unique').on(table.repoOwner, table.repoName, table.skillPath)
]);

// ========== Authors ==========
export const authors = sqliteTable('authors', {
  id: text('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  username: text('username').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  type: text('type'), // 'User' or 'Organization' (from GitHub API)
  userId: text('user_id'), // Better Auth user ID (linked after signup)
  skillsCount: integer('skills_count').default(0),
  totalStars: integer('total_stars').default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('authors_username_idx').on(table.username),
  index('authors_user_id_idx').on(table.userId)
]);

// ========== Skill Permissions ==========
export const skillPermissions = sqliteTable('skill_permissions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  granteeType: text('grantee_type').notNull(), // 'user', 'email'
  granteeId: text('grantee_id').notNull(), // user_id or email
  permission: text('permission').notNull().default('read'), // 'read', 'write'
  grantedBy: text('granted_by').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' })
}, (table) => [
  uniqueIndex('skill_permissions_unique_idx').on(table.skillId, table.granteeType, table.granteeId),
  index('skill_permissions_skill_idx').on(table.skillId),
  index('skill_permissions_grantee_idx').on(table.granteeType, table.granteeId)
]);

// ========== API Tokens ==========
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(), // First 8 chars for identification
  scopes: text('scopes').notNull().default('["read"]'), // JSON array
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
}, (table) => [
  index('api_tokens_user_idx').on(table.userId),
  index('api_tokens_hash_idx').on(table.tokenHash)
]);

// ========== Content Hashes (Anti-Abuse) ==========
export const contentHashes = sqliteTable('content_hashes', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  hashType: text('hash_type').notNull(), // 'full', 'normalized'
  hashValue: text('hash_value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  uniqueIndex('content_hashes_unique_idx').on(table.skillId, table.hashType),
  index('content_hashes_lookup_idx').on(table.hashType, table.hashValue)
]);

// ========== Skill Categories (many-to-many) ==========
export const skillCategories = sqliteTable('skill_categories', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  categorySlug: text('category_slug').notNull() // References CATEGORIES constant
}, (table) => [
  primaryKey({ columns: [table.skillId, table.categorySlug] }),
  index('skill_categories_category_idx').on(table.categorySlug)
]);

// ========== Skill Tags (from SKILL.md frontmatter) ==========
export const skillTags = sqliteTable('skill_tags', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(), // Normalized lowercase tag from frontmatter
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.skillId, table.tag] }),
  index('skill_tags_tag_idx').on(table.tag)
]);

// ========== Favorites ==========
export const favorites = sqliteTable('favorites', {
  userId: text('user_id').notNull(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.userId, table.skillId] })
]);

// ========== User Actions ==========
export const userActions = sqliteTable('user_actions', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  skillId: text('skill_id').references(() => skills.id, { onDelete: 'set null' }),
  actionType: text('action_type').notNull(), // 'install', 'copy_command', 'download'
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('user_actions_skill_idx').on(table.skillId),
  index('user_actions_user_idx').on(table.userId)
]);

// ========== Device Codes (CLI Device Authorization Flow) ==========
export const deviceCodes = sqliteTable('device_codes', {
  id: text('id').primaryKey(),
  deviceCode: text('device_code').notNull().unique(),  // 64-char random, CLI polls with this
  userCode: text('user_code').notNull().unique(),      // 8-char XXXX-XXXX, user enters this
  userId: text('user_id'),                             // Filled after authorization
  scopes: text('scopes').notNull().default('["read","write","publish"]'),
  clientInfo: text('client_info'),                     // JSON: { os, hostname, version }
  status: text('status').notNull().default('pending'), // pending/authorized/denied/expired/used
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  authorizedAt: integer('authorized_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('device_codes_device_code_idx').on(table.deviceCode),
  index('device_codes_user_code_idx').on(table.userCode),
  index('device_codes_status_idx').on(table.status)
]);

// ========== Refresh Tokens ==========
export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),         // First 8 chars for identification
  accessTokenId: text('access_token_id'),              // Associated access token
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
}, (table) => [
  index('refresh_tokens_user_idx').on(table.userId),
  index('refresh_tokens_hash_idx').on(table.tokenHash)
]);

// ========== Types Export ==========
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;
export type SkillPermission = typeof skillPermissions.$inferSelect;
export type NewSkillPermission = typeof skillPermissions.$inferInsert;
export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
export type ContentHash = typeof contentHashes.$inferSelect;
export type NewContentHash = typeof contentHashes.$inferInsert;
export type SkillCategory = typeof skillCategories.$inferSelect;
export type SkillTag = typeof skillTags.$inferSelect;
export type NewSkillTag = typeof skillTags.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type UserAction = typeof userActions.$inferSelect;
export type DeviceCode = typeof deviceCodes.$inferSelect;
export type NewDeviceCode = typeof deviceCodes.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
