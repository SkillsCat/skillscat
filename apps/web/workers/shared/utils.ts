/**
 * Shared Utilities for Workers
 */

// ============================================
// Path Utilities
// ============================================

/**
 * Check if a path starts with a dot folder (e.g., .claude/, .cursor/, .trae/)
 * Skills in dot folders are IDE-specific configurations and should not be indexed
 * as standalone skills in the registry.
 *
 * This covers all IDE/Agent tools that store skills in dot folders:
 * .claude, .cursor, .trae, .qoder, .codebuddy, .windsurf, .gemini,
 * .github, .goose, .kiro, .roo, .agents, .agent, .codex, .factory,
 * .kilocode, .opencode, .neovate, .vscode, etc.
 */
export function isInDotFolder(path: string): boolean {
  // Check if path starts with a dot folder (e.g., ".something/")
  return /^\.[\w-]+\//.test(path);
}

// ============================================
// GitHub API Utilities
// ============================================

const GITHUB_API_BASE = 'https://api.github.com';

export interface GitHubFetchOptions {
  token?: string;
  apiVersion?: string;
  userAgent?: string;
}

/**
 * Generic GitHub API fetch with error handling
 */
export async function githubFetch<T>(
  url: string,
  options: GitHubFetchOptions = {}
): Promise<T | null> {
  const {
    token,
    apiVersion = '2022-11-28',
    userAgent = 'SkillsCat-Worker/1.0'
  } = options;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': apiVersion,
    'User-Agent': userAgent,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Build GitHub API URL for repository
 */
export function getRepoApiUrl(owner: string, name: string): string {
  return `${GITHUB_API_BASE}/repos/${owner}/${name}`;
}

/**
 * Build GitHub API URL for repository contents
 */
export function getContentsApiUrl(owner: string, name: string, path: string): string {
  return `${GITHUB_API_BASE}/repos/${owner}/${name}/contents/${path}`;
}

// ============================================
// String Utilities
// ============================================

/**
 * Generate a UUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a URL-friendly slug from owner and repo name
 */
export function generateSlug(owner: string, name: string): string {
  return `${owner}-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Decode base64 content (handles newlines in GitHub API responses)
 */
export function decodeBase64(content: string): string {
  return atob(content.replace(/\n/g, ''));
}

// ============================================
// Logger Utility
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  log: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * Create a prefixed logger for a specific worker/module
 * @param prefix - The prefix to add to all log messages (e.g., 'Indexing', 'Classification')
 */
export function createLogger(prefix: string): Logger {
  const formatMessage = (message: string) => `[${prefix}] ${message}`;

  return {
    debug: (message: string, ...args: unknown[]) => {
      console.debug(formatMessage(message), ...args);
    },
    info: (message: string, ...args: unknown[]) => {
      console.info(formatMessage(message), ...args);
    },
    log: (message: string, ...args: unknown[]) => {
      console.log(formatMessage(message), ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      console.warn(formatMessage(message), ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      console.error(formatMessage(message), ...args);
    },
  };
}
