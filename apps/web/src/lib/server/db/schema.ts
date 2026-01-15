import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ========== Skills ==========
export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  githubUrl: text('github_url').notNull().unique(),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  skillPath: text('skill_path').notNull(),
  stars: integer('stars').default(0),
  forks: integer('forks').default(0),
  starSnapshots: text('star_snapshots'), // JSON: [{d, s}]
  trendingScore: real('trending_score').default(0),
  fileStructure: text('file_structure'), // JSON
  readme: text('readme'),
  lastCommitAt: integer('last_commit_at'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('skills_slug_idx').on(table.slug),
  index('skills_trending_idx').on(table.trendingScore),
  index('skills_stars_idx').on(table.stars),
  index('skills_indexed_idx').on(table.indexedAt)
]);

// ========== Authors ==========
export const authors = sqliteTable('authors', {
  id: text('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  username: text('username').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  bio: text('bio'),
  skillsCount: integer('skills_count').default(0),
  totalStars: integer('total_stars').default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('authors_username_idx').on(table.username)
]);

// ========== Skill Categories (many-to-many) ==========
export const skillCategories = sqliteTable('skill_categories', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  categorySlug: text('category_slug').notNull() // References CATEGORIES constant
}, (table) => [
  primaryKey({ columns: [table.skillId, table.categorySlug] }),
  index('skill_categories_category_idx').on(table.categorySlug)
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

// ========== Types Export ==========
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;
export type SkillCategory = typeof skillCategories.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type UserAction = typeof userActions.$inferSelect;
