/**
 * Indexing Worker Types
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Storage
  R2: R2Bucket;

  // Queue Producer
  CLASSIFICATION_QUEUE: Queue<ClassificationMessage>;

  // Environment Variables
  GITHUB_TOKEN?: string;
  GITHUB_API_VERSION?: string;
}

/**
 * Message received from GitHub Events Worker
 */
export interface IndexingMessage {
  type: 'check_skill';
  repoOwner: string;
  repoName: string;
  eventId: string;
  eventType: string;
  createdAt: string;
}

/**
 * Message sent to Classification Worker
 */
export interface ClassificationMessage {
  type: 'classify';
  skillId: string;
  repoOwner: string;
  repoName: string;
  skillMdPath: string; // R2 path
}

/**
 * GitHub Repository Info
 */
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

/**
 * GitHub Content (for SKILL.md)
 */
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
  content?: string; // Base64 encoded
  encoding?: string;
}

/**
 * Skill record in database
 */
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
  language: string | null;
  license: string | null;
  topics: string | null; // JSON array
  author_id: string;
  trending_score: number;
  created_at: number;
  updated_at: number;
  indexed_at: number;
}

/**
 * Author record in database
 */
export interface AuthorRecord {
  id: string;
  github_id: number;
  username: string;
  avatar_url: string;
  type: string;
  created_at: number;
  updated_at: number;
}
