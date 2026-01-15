/**
 * Trending Worker Types
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Storage
  R2: R2Bucket;

  // KV Namespace
  KV: KVNamespace;

  // Environment Variables
  GITHUB_TOKEN?: string;
  TRENDING_DECAY_HOURS?: string;
  TRENDING_STAR_WEIGHT?: string;
  TRENDING_FORK_WEIGHT?: string;
  TRENDING_VIEW_WEIGHT?: string;
}

/**
 * Star snapshot for tracking growth
 */
export interface StarSnapshot {
  d: string; // YYYY-MM-DD
  s: number; // star count
}

/**
 * Skill record from database
 */
export interface SkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  repo_url: string;
  stars: number;
  forks: number;
  star_snapshots: string | null; // JSON array
  trending_score: number;
  indexed_at: number;
  updated_at: number;
  last_commit_at: number | null;
}

/**
 * GitHub repo data
 */
export interface GitHubRepoData {
  stars: number;
  forks: number;
  pushedAt: number;
}

/**
 * Cached list data
 */
export interface CachedList {
  data: SkillListItem[];
  generatedAt: number;
}

export interface SkillListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  stars: number;
  forks: number;
  trending_score: number;
  updated_at: number;
  author_avatar?: string;
  categories?: string[];
}
