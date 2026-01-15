/**
 * GitHub Events Worker Types
 */

export interface Env {
  // KV Namespace
  KV: KVNamespace;

  // D1 Database
  DB: D1Database;

  // Queue Producer
  INDEXING_QUEUE: Queue<IndexingMessage>;

  // Environment Variables
  GITHUB_TOKEN?: string;
  WORKER_SECRET?: string;
  GITHUB_EVENTS_PER_PAGE?: string;
}

/**
 * GitHub Event from Events API
 */
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
    name: string; // format: "owner/repo"
    url: string;
  };
  payload: GitHubEventPayload;
  public: boolean;
  created_at: string;
}

export interface GitHubEventPayload {
  // PushEvent payload
  push_id?: number;
  size?: number;
  distinct_size?: number;
  ref?: string;
  head?: string;
  before?: string;
  commits?: GitHubCommit[];

  // CreateEvent payload
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

/**
 * Message sent to Indexing Queue
 */
export interface IndexingMessage {
  type: 'check_skill';
  repoOwner: string;
  repoName: string;
  eventId: string;
  eventType: string;
  createdAt: string;
}
