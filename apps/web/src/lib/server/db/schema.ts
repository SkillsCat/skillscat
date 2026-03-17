import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { buildRecentActivitySortSql, buildTopRatedSortScoreSql } from '../ranking';

const TOP_RATED_SORT_SCORE_SQL = buildTopRatedSortScoreSql('stars', 'download_count_90d');
const TOP_RATED_RECENT_ACTIVITY_SQL = buildRecentActivitySortSql('last_commit_at', 'updated_at');

// ========== Better Auth Tables ==========
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('user_name_idx').on(table.name),
]);

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('session_user_idx').on(table.userId),
]);

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('account_user_idx').on(table.userId),
  index('account_provider_account_idx').on(table.providerId, table.accountId),
]);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

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
  index('organizations_owner_idx').on(table.ownerId),
  index('organizations_updated_idx').on(table.updatedAt)
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
  githubUrl: text('github_url'), // Not unique - multi-skill repos share the same URL
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
  skillPath: text('skill_path'),
  stars: integer('stars').default(0),
  forks: integer('forks').default(0),
  starSnapshots: text('star_snapshots'), // JSON: [{d, s}]
  trendingScore: real('trending_score').default(0),
  fileStructure: text('file_structure'), // JSON
  commitSha: text('commit_sha'), // 存储最新索引的 commit SHA
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
  downloadCount7d: integer('download_count_7d').notNull().default(0),
  downloadCount30d: integer('download_count_30d').notNull().default(0),
  downloadCount90d: integer('download_count_90d').notNull().default(0),
  classificationMethod: text('classification_method'), // 'ai', 'keyword', 'skipped'
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  indexedAt: integer('indexed_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  uniqueIndex('skills_slug_unique').on(table.slug),
  index('skills_trending_idx').on(table.trendingScore),
  index('skills_stars_idx').on(table.stars),
  index('skills_indexed_idx').on(table.indexedAt),
  index('skills_visibility_idx').on(table.visibility),
  index('skills_visibility_id_idx').on(table.visibility, table.id),
  index('skills_visibility_name_idx').on(table.visibility, table.name),
  index('skills_visibility_repo_owner_idx').on(table.visibility, table.repoOwner),
  index('skills_visibility_repo_name_idx').on(table.visibility, table.repoName),
  index('skills_visibility_slug_idx').on(table.visibility, table.slug),
  index('skills_visibility_org_idx').on(table.visibility, table.orgId),
  index('skills_visibility_trending_desc_idx').on(table.visibility, table.trendingScore),
  index('skills_visibility_stars_desc_idx').on(table.visibility, table.stars),
  index('skills_repo_visibility_trending_idx').on(table.repoOwner, table.visibility, table.trendingScore),
  index('skills_visibility_recent_expr_idx').on(
    table.visibility,
    sql`CASE WHEN last_commit_at IS NULL THEN indexed_at ELSE last_commit_at END DESC`
  ),
  index('skills_owner_idx').on(table.ownerId),
  index('skills_owner_created_idx').on(table.ownerId, table.createdAt),
  index('skills_owner_visibility_stars_idx').on(table.ownerId, table.visibility, table.stars),
  index('skills_org_stars_created_idx').on(table.orgId, table.stars, table.createdAt),
  index('skills_org_visibility_stars_created_idx').on(table.orgId, table.visibility, table.stars, table.createdAt),
  index('skills_content_hash_idx').on(table.contentHash),
  // Cost optimization indexes
  index('skills_tier_idx').on(table.tier),
  index('skills_next_update_idx').on(table.nextUpdateAt),
  index('skills_nonzero_download_counts_idx')
    .on(table.id)
    .where(sql`${table.downloadCount7d} != 0 OR ${table.downloadCount30d} != 0 OR ${table.downloadCount90d} != 0`),
  index('skills_nonzero_access_counts_idx')
    .on(table.id)
    .where(sql`${table.accessCount7d} != 0 OR ${table.accessCount30d} != 0`),
  index('skills_public_tier_due_idx')
    .on(table.tier, table.nextUpdateAt)
    .where(sql`${table.visibility} = 'public'`),
  index('skills_top_public_rank_expr_idx')
    .on(
      sql.raw(`${TOP_RATED_SORT_SCORE_SQL} DESC`),
      sql.raw(`download_count_90d DESC`),
      sql.raw(`download_count_30d DESC`),
      sql.raw(`stars DESC`),
      sql.raw(`trending_score DESC`),
      sql.raw(`${TOP_RATED_RECENT_ACTIVITY_SQL} DESC`)
    )
    .where(sql.raw(`visibility = 'public' AND (
      skill_path IS NULL
      OR skill_path = ''
      OR (
        skill_path NOT LIKE '.%'
        AND skill_path NOT LIKE '%/.%'
      )
    )`)),
  // Unique constraint for multi-skill repos (same repo can have multiple skills with different paths)
  uniqueIndex('skills_repo_path_unique').on(
    table.repoOwner,
    table.repoName,
    sql`COALESCE(${table.skillPath}, '')`
  )
]);

// ========== Recommend Precompute State (one row per skill) ==========
export const skillRecommendState = sqliteTable('skill_recommend_state', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  dirty: integer('dirty').notNull().default(1),
  nextUpdateAt: integer('next_update_at', { mode: 'timestamp_ms' }),
  precomputedAt: integer('precomputed_at', { mode: 'timestamp_ms' }),
  algoVersion: text('algo_version'),
  failCount: integer('fail_count').notNull().default(0),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
  lastFallbackAt: integer('last_fallback_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.skillId] }),
  index('skill_recommend_state_dirty_due_idx').on(table.dirty, table.nextUpdateAt),
  index('skill_recommend_state_due_idx').on(table.nextUpdateAt),
  index('skill_recommend_state_algo_dirty_idx').on(table.algoVersion, table.dirty),
  index('skill_recommend_state_precomputed_null_idx')
    .on(table.skillId)
    .where(sql`${table.precomputedAt} IS NULL`),
  index('skill_recommend_state_next_update_null_idx')
    .on(table.skillId)
    .where(sql`${table.nextUpdateAt} IS NULL`),
  index('skill_recommend_state_algo_null_idx')
    .on(table.skillId)
    .where(sql`${table.algoVersion} IS NULL`)
]);

// ========== Search Precompute State (one row per skill) ==========
export const skillSearchState = sqliteTable('skill_search_state', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  dirty: integer('dirty').notNull().default(1),
  nextUpdateAt: integer('next_update_at', { mode: 'timestamp_ms' }),
  precomputedAt: integer('precomputed_at', { mode: 'timestamp_ms' }),
  algoVersion: text('algo_version'),
  score: real('score'),
  failCount: integer('fail_count').notNull().default(0),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.skillId] }),
  index('skill_search_state_dirty_due_idx').on(table.dirty, table.nextUpdateAt),
  index('skill_search_state_due_idx').on(table.nextUpdateAt),
  index('skill_search_state_algo_dirty_idx').on(table.algoVersion, table.dirty),
  index('skill_search_state_score_idx').on(table.score),
  index('skill_search_state_precomputed_null_idx')
    .on(table.skillId)
    .where(sql`${table.precomputedAt} IS NULL`),
  index('skill_search_state_next_update_null_idx')
    .on(table.skillId)
    .where(sql`${table.nextUpdateAt} IS NULL`),
  index('skill_search_state_algo_null_idx')
    .on(table.skillId)
    .where(sql`${table.algoVersion} IS NULL`)
]);

// ========== Search Terms Index (one row per skill-term) ==========
export const skillSearchTerms = sqliteTable('skill_search_terms', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  term: text('term').notNull(),
  source: text('source').notNull().default('token'),
  weight: real('weight').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.skillId, table.term] }),
  index('skill_search_terms_term_idx').on(table.term),
  index('skill_search_terms_skill_idx').on(table.skillId),
  index('skill_search_terms_term_weight_idx').on(table.term, table.weight)
]);

// ========== Skill Security State (one row per skill) ==========
export const skillSecurityState = sqliteTable('skill_security_state', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  contentFingerprint: text('content_fingerprint'),
  dirty: integer('dirty').notNull().default(1),
  nextUpdateAt: integer('next_update_at', { mode: 'timestamp_ms' }),
  status: text('status').notNull().default('pending'),
  lastAnalyzedAt: integer('last_analyzed_at', { mode: 'timestamp_ms' }),
  currentTotalScore: real('current_total_score'),
  currentRiskLevel: text('current_risk_level'),
  currentFreeScanId: text('current_free_scan_id'),
  currentPremiumScanId: text('current_premium_scan_id'),
  openSecurityReportCount: integer('open_security_report_count').notNull().default(0),
  reportRiskLevel: text('report_risk_level').notNull().default('low'),
  premiumDueReason: text('premium_due_reason'),
  premiumRequestedAt: integer('premium_requested_at', { mode: 'timestamp_ms' }),
  premiumRequestedFingerprint: text('premium_requested_fingerprint'),
  premiumLastAnalyzedFingerprint: text('premium_last_analyzed_fingerprint'),
  vtEligibility: text('vt_eligibility').notNull().default('unknown'),
  vtPriority: integer('vt_priority').notNull().default(0),
  vtBundleSha256: text('vt_bundle_sha256'),
  vtBundleSize: integer('vt_bundle_size'),
  vtStatus: text('vt_status').notNull().default('pending'),
  vtAnalysisId: text('vt_analysis_id'),
  vtLastStats: text('vt_last_stats'),
  vtNextAttemptAt: integer('vt_next_attempt_at', { mode: 'timestamp_ms' }),
  vtLastAttemptAt: integer('vt_last_attempt_at', { mode: 'timestamp_ms' }),
  vtLastSubmittedAt: integer('vt_last_submitted_at', { mode: 'timestamp_ms' }),
  vtLastCompletedAt: integer('vt_last_completed_at', { mode: 'timestamp_ms' }),
  failCount: integer('fail_count').notNull().default(0),
  lastError: text('last_error'),
  lastErrorAt: integer('last_error_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.skillId] }),
  index('skill_security_state_dirty_due_idx').on(table.dirty, table.nextUpdateAt),
  index('skill_security_state_status_due_idx').on(table.status, table.nextUpdateAt),
  index('skill_security_state_report_level_idx').on(table.reportRiskLevel, table.openSecurityReportCount),
  index('skill_security_state_premium_due_idx').on(table.premiumDueReason, table.premiumRequestedAt),
  index('skill_security_state_vt_due_idx').on(table.vtStatus, table.vtNextAttemptAt),
  index('skill_security_state_vt_priority_idx').on(table.vtPriority, table.vtNextAttemptAt),
  index('skill_security_state_vt_sha_idx').on(table.vtBundleSha256)
]);

// ========== Skill Security Scans ==========
export const skillSecurityScans = sqliteTable('skill_security_scans', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  contentFingerprint: text('content_fingerprint').notNull(),
  analysisTier: text('analysis_tier').notNull(),
  status: text('status').notNull().default('completed'),
  provider: text('provider'),
  model: text('model'),
  totalScore: real('total_score'),
  riskLevel: text('risk_level'),
  summary: text('summary'),
  findings: text('findings'),
  rounds: integer('rounds').notNull().default(0),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCostUsd: real('estimated_cost_usd'),
  analyzedAt: integer('analyzed_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  uniqueIndex('skill_security_scans_unique_idx').on(table.skillId, table.contentFingerprint, table.analysisTier),
  index('skill_security_scans_skill_tier_idx').on(table.skillId, table.analysisTier, table.analyzedAt),
  index('skill_security_scans_level_idx').on(table.riskLevel, table.totalScore)
]);

// ========== Skill Security Scan Dimensions ==========
export const skillSecurityScanDimensions = sqliteTable('skill_security_scan_dimensions', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull().references(() => skillSecurityScans.id, { onDelete: 'cascade' }),
  dimension: text('dimension').notNull(),
  score: real('score').notNull(),
  reason: text('reason'),
  findingCount: integer('finding_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  uniqueIndex('skill_security_scan_dimensions_unique_idx').on(table.scanId, table.dimension),
  index('skill_security_scan_dimensions_dimension_idx').on(table.dimension, table.score)
]);

// ========== Skill Security File Scores ==========
export const skillSecurityFileScores = sqliteTable('skill_security_file_scores', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull().references(() => skillSecurityScans.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  fileKind: text('file_kind').notNull(),
  source: text('source').notNull().default('heuristic'),
  dimension: text('dimension').notNull(),
  score: real('score').notNull(),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  uniqueIndex('skill_security_file_scores_unique_idx').on(table.scanId, table.filePath, table.dimension, table.source),
  index('skill_security_file_scores_scan_file_idx').on(table.scanId, table.filePath),
  index('skill_security_file_scores_dimension_idx').on(table.dimension, table.score)
]);

// ========== Skill Reports ==========
export const skillReports = sqliteTable('skill_reports', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  reporterUserId: text('reporter_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  details: text('details'),
  source: text('source').notNull().default('cli'),
  status: text('status').notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' })
}, (table) => [
  uniqueIndex('skill_reports_open_unique_idx')
    .on(table.skillId, table.reporterUserId, table.reason)
    .where(sql`${table.status} = 'open'`),
  index('skill_reports_skill_reason_status_idx').on(table.skillId, table.reason, table.status, table.createdAt),
  index('skill_reports_reporter_idx').on(table.reporterUserId, table.reason, table.createdAt)
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
  index('authors_user_id_idx').on(table.userId),
  index('authors_sitemap_updated_partial_idx')
    .on(table.updatedAt)
    .where(sql`${table.username} IS NOT NULL AND ${table.skillsCount} > 0`)
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
  userId: text('user_id'), // Null for org-only tokens
  orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }), // Null for user-only tokens
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
  index('api_tokens_org_idx').on(table.orgId)
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
  categorySlug: text('category_slug').notNull() // References CATEGORIES constant or categories table
}, (table) => [
  primaryKey({ columns: [table.skillId, table.categorySlug] }),
  index('skill_categories_category_idx').on(table.categorySlug),
  index('skill_categories_category_skill_idx').on(table.categorySlug, table.skillId)
]);

// ========== Categories (for AI-suggested dynamic categories) ==========
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull().default('predefined'), // 'predefined' | 'ai-suggested'
  parentSection: text('parent_section'), // For predefined: section id (e.g., 'development', 'lifestyle')
  suggestedBySkillId: text('suggested_by_skill_id').references(() => skills.id, { onDelete: 'set null' }),
  skillCount: integer('skill_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('categories_type_idx').on(table.type)
]);

// ========== Skill Tags (from SKILL.md frontmatter) ==========
export const skillTags = sqliteTable('skill_tags', {
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(), // Normalized lowercase tag from frontmatter
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.skillId, table.tag] }),
  index('skill_tags_tag_idx').on(table.tag),
  index('skill_tags_tag_skill_idx').on(table.tag, table.skillId)
]);

// ========== Favorites ==========
export const favorites = sqliteTable('favorites', {
  userId: text('user_id').notNull(),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  primaryKey({ columns: [table.userId, table.skillId] }),
  index('favorites_user_created_idx').on(table.userId, table.createdAt)
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
  index('user_actions_user_idx').on(table.userId),
  index('user_actions_action_created_idx').on(table.actionType, table.createdAt),
  index('user_actions_action_skill_created_idx').on(table.actionType, table.skillId, table.createdAt)
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
  index('device_codes_status_idx').on(table.status)
]);

// ========== Notifications ==========
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'org_invite', 'skill_shared', etc.
  title: text('title').notNull(),
  message: text('message'),
  metadata: text('metadata'), // JSON: { orgId, orgSlug, orgName, inviterId, inviterName, role }
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
  processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
}, (table) => [
  index('notifications_user_idx').on(table.userId),
  index('notifications_user_read_idx').on(table.userId, table.read),
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
  index('refresh_tokens_user_idx').on(table.userId)
]);

// ========== CLI Auth Sessions (OAuth-style callback flow) ==========
export const cliAuthSessions = sqliteTable('cli_auth_sessions', {
  id: text('id').primaryKey(),
  callbackUrl: text('callback_url').notNull(),
  state: text('state').notNull(),
  authCode: text('auth_code'),
  userId: text('user_id'),
  scopes: text('scopes').notNull().default('["read","write","publish"]'),
  clientInfo: text('client_info'),
  // PKCE (Proof Key for Code Exchange) fields
  codeChallenge: text('code_challenge'),
  codeChallengeMethod: text('code_challenge_method'), // 'S256' or 'plain'
  status: text('status').notNull().default('pending'), // pending/authorized/denied/expired/used
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`)
}, (table) => [
  index('cli_auth_sessions_status_idx').on(table.status)
]);

// ========== Types Export ==========
// Better Auth types
export type AuthUser = typeof user.$inferSelect;
export type AuthSession = typeof session.$inferSelect;
export type AuthAccount = typeof account.$inferSelect;
export type AuthVerification = typeof verification.$inferSelect;
// Application types
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type SkillSecurityState = typeof skillSecurityState.$inferSelect;
export type NewSkillSecurityState = typeof skillSecurityState.$inferInsert;
export type SkillSecurityScan = typeof skillSecurityScans.$inferSelect;
export type NewSkillSecurityScan = typeof skillSecurityScans.$inferInsert;
export type SkillSecurityScanDimension = typeof skillSecurityScanDimensions.$inferSelect;
export type NewSkillSecurityScanDimension = typeof skillSecurityScanDimensions.$inferInsert;
export type SkillSecurityFileScore = typeof skillSecurityFileScores.$inferSelect;
export type NewSkillSecurityFileScore = typeof skillSecurityFileScores.$inferInsert;
export type SkillReport = typeof skillReports.$inferSelect;
export type NewSkillReport = typeof skillReports.$inferInsert;
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
export type CategoryRecord = typeof categories.$inferSelect;
export type NewCategoryRecord = typeof categories.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type UserAction = typeof userActions.$inferSelect;
export type DeviceCode = typeof deviceCodes.$inferSelect;
export type NewDeviceCode = typeof deviceCodes.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type CliAuthSession = typeof cliAuthSessions.$inferSelect;
export type NewCliAuthSession = typeof cliAuthSessions.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
