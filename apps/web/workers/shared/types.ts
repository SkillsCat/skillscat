/**
 * Shared Types for Workers
 */

// ============================================
// Cloudflare Workers Types
// ============================================

/**
 * Cloudflare Workers ExecutionContext
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Cloudflare Workers ScheduledController
 */
export interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

/**
 * Cloudflare Workers Queue Message
 */
export interface Message<T> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: T;
  ack(): void;
  retry(): void;
}

/**
 * Cloudflare Workers MessageBatch
 */
export interface MessageBatch<T> {
  readonly queue: string;
  readonly messages: readonly Message<T>[];
  ackAll(): void;
  retryAll(): void;
}

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
  AI_MODEL?: string; // Optional: override default free model
  FREE_MODELS?: string; // Optional: comma-separated list of free models for fallback
  DEEPSEEK_API_KEY?: string; // Optional: DeepSeek API key for fallback
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
  // From GitHub events worker
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  // From user submission
  skillPath?: string;
  submittedBy?: string;
  submittedAt?: string;
  // Force reindex flag
  forceReindex?: boolean;
}

// ============================================
// Directory Indexing Types
// ============================================

// 目录文件信息
export interface DirectoryFile {
  path: string;           // 相对于 skill 目录的路径
  sha: string;            // 文件 SHA
  size: number;           // 文件大小
  type: 'text' | 'binary'; // 文件类型
}

// 目录结构（存储到 file_structure 字段）
export interface FileStructure {
  commitSha: string;      // 索引时的 commit SHA
  indexedAt: string;      // 索引时间
  files: DirectoryFile[]; // 扁平文件列表 (用于 R2 缓存查找)
  fileTree: FileNode[];   // 树形结构 (用于前端展示)
}

// 文件树节点 (用于前端展示)
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

// GitHub Tree API 响应
export interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  mode: string;
}

export interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

export interface ClassificationMessage {
  type: 'classify';
  skillId: string;
  repoOwner: string;
  repoName: string;
  skillMdPath: string;
  frontmatterCategories?: string[];  // Direct categories from frontmatter for cost optimization
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

export type SkillTier = 'hot' | 'warm' | 'cool' | 'cold' | 'archived';
export type ClassificationMethod = 'ai' | 'keyword' | 'skipped' | 'direct';

export interface SkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  skill_path: string | null;
  github_url: string | null;
  stars: number;
  forks: number;
  star_snapshots: string | null;
  trending_score: number;
  file_structure: string | null;
  readme: string | null;
  last_commit_at: number | null;
  visibility: string;
  owner_id: string | null;
  org_id: string | null;
  source_type: string;
  content_hash: string | null;
  verified_repo_url: string | null;
  // Cost optimization fields
  tier: SkillTier;
  last_accessed_at: number | null;
  access_count_7d: number;
  access_count_30d: number;
  next_update_at: number | null;
  classification_method: ClassificationMethod | null;
  created_at: number;
  updated_at: number;
  indexed_at: number;
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

// Tier configuration: update intervals in milliseconds
export const TIER_CONFIG = {
  hot: {
    updateInterval: 6 * 60 * 60 * 1000,      // 6 hours
    minStars: 1000,
    accessWindow: 7 * 24 * 60 * 60 * 1000,   // 7 days
  },
  warm: {
    updateInterval: 24 * 60 * 60 * 1000,     // 24 hours
    minStars: 100,
    accessWindow: 30 * 24 * 60 * 60 * 1000,  // 30 days
  },
  cool: {
    updateInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
    minStars: 10,
    accessWindow: 90 * 24 * 60 * 60 * 1000,  // 90 days
  },
  cold: {
    updateInterval: 0, // Only on access
    minStars: 0,
    accessWindow: 365 * 24 * 60 * 60 * 1000, // 1 year
  },
  archived: {
    updateInterval: 0, // Never
    minStars: 0,
    accessWindow: 0,
  },
} as const;

// Known high-quality organizations that always get AI classification
export const KNOWN_ORGS = [
  'anthropics',
  'openai',
  'google',
  'microsoft',
  'facebook',
  'meta',
  'vercel',
  'cloudflare',
  'supabase',
  'prisma',
  'drizzle-team',
  'sveltejs',
  'vuejs',
  'reactjs',
] as const;

export interface GitHubGraphQLRepoData {
  stargazerCount: number;
  forkCount: number;
  pushedAt: string;
  description: string | null;
  repositoryTopics: {
    nodes: Array<{ topic: { name: string } }>;
  };
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
