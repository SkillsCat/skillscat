/**
 * Shared Types for Workers
 */

// ============================================
// Environment Types
// ============================================

export interface BaseEnv {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  GITHUB_TOKEN?: string;
  WORKER_SECRET?: string;
}

export interface GithubEventsEnv extends BaseEnv {
  INDEXING_QUEUE: Queue<IndexingMessage>;
  GITHUB_EVENTS_PER_PAGE?: string;
}

export interface IndexingEnv extends BaseEnv {
  CLASSIFICATION_QUEUE: Queue<ClassificationMessage>;
  GITHUB_API_VERSION?: string;
}

export interface ClassificationEnv extends BaseEnv {
  OPENROUTER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
}

export interface TrendingEnv extends BaseEnv {
  TRENDING_DECAY_HOURS?: string;
  TRENDING_STAR_WEIGHT?: string;
  TRENDING_FORK_WEIGHT?: string;
  TRENDING_VIEW_WEIGHT?: string;
}

// ============================================
// Queue Messages
// ============================================

export interface IndexingMessage {
  type: 'check_skill';
  repoOwner: string;
  repoName: string;
  eventId: string;
  eventType: string;
  createdAt: string;
}

export interface ClassificationMessage {
  type: 'classify';
  skillId: string;
  repoOwner: string;
  repoName: string;
  skillMdPath: string;
}

// ============================================
// GitHub Types
// ============================================

export interface GitHubEvent {
  id: string;
  type: string;
  actor: {
    id: number;
    login: string;
    display_login?: string;
    avatar_url: string;
  };
  repo: {
    id: number;
    name: string;
    url: string;
  };
  payload: GitHubEventPayload;
  public: boolean;
  created_at: string;
}

export interface GitHubEventPayload {
  push_id?: number;
  size?: number;
  distinct_size?: number;
  ref?: string;
  head?: string;
  before?: string;
  commits?: GitHubCommit[];
  ref_type?: string;
  master_branch?: string;
  description?: string;
  pusher_type?: string;
}

export interface GitHubCommit {
  sha: string;
  author: {
    email: string;
    name: string;
  };
  message: string;
  distinct: boolean;
  url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
    type: string;
  };
  html_url: string;
  description: string | null;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  homepage: string | null;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  language: string | null;
  license: {
    key: string;
    name: string;
    spdx_id: string;
  } | null;
  topics: string[];
  default_branch: string;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

export interface GitHubRepoData {
  stars: number;
  forks: number;
  pushedAt: number;
}

// ============================================
// Database Types
// ============================================

export interface SkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  repo_url: string;
  skill_md_url: string;
  stars: number;
  forks: number;
  star_snapshots: string | null;
  language: string | null;
  license: string | null;
  topics: string | null;
  author_id: string;
  trending_score: number;
  created_at: number;
  updated_at: number;
  indexed_at: number;
  last_commit_at: number | null;
}

export interface AuthorRecord {
  id: string;
  github_id: number;
  username: string;
  avatar_url: string;
  type: string;
  created_at: number;
  updated_at: number;
}

// ============================================
// Classification Types
// ============================================

export interface Category {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  keywords: string[];
}

export interface ClassificationResult {
  categories: string[];
  confidence: number;
  reasoning?: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================
// Trending Types
// ============================================

export interface StarSnapshot {
  d: string;
  s: number;
}

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
