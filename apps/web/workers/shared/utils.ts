/**
 * Shared Utilities for Workers
 */

// ============================================
// Text File Detection
// ============================================

// Text file extensions that we should include
export const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp',
  'html', 'css', 'scss', 'less', 'sass',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'xml', 'svg', 'sql', 'graphql', 'gql',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'svelte', 'vue', 'astro'
]);

/**
 * Check if a file is a text file based on extension
 */
export function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (!ext || TEXT_EXTENSIONS.has(ext)) return true;
  const fileName = path.split('/').pop()?.toLowerCase() || '';
  if (['dockerfile', 'makefile', 'readme', 'license', 'changelog'].includes(fileName)) return true;
  return false;
}

/**
 * Decode base64 content to UTF-8 string (handles non-ASCII characters)
 */
export function decodeBase64ToUtf8(base64: string): string {
  const cleanBase64 = base64.replace(/\n/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

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
 * Generate a URL-friendly slug
 * For multi-skill repos: prefer displayName, fallback to skillPath
 *
 * @param owner - Repository owner
 * @param name - Repository name
 * @param skillPath - Optional path to skill within repo (e.g., "skills/remotion")
 * @param displayName - Optional display name from frontmatter
 * @returns URL-friendly slug
 *
 * Examples:
 * - Root skill: "remotion-dev-remotion"
 * - Subfolder with displayName: "remotion-dev-skills-remotion-best-practices"
 * - Subfolder without displayName: "remotion-dev-skills-skills-remotion"
 */
export function generateSlug(
  owner: string,
  name: string,
  skillPath?: string,
  displayName?: string
): string {
  let slug = `${owner}-${name}`;

  if (skillPath) {
    // Normalize: remove leading/trailing slashes
    const normalizedPath = skillPath.replace(/^\/|\/$/g, '');

    if (displayName) {
      // Use displayName (from frontmatter) - normalize to URL-friendly format
      const normalizedDisplayName = displayName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      slug = `${slug}-${normalizedDisplayName}`;
    } else {
      // Fallback to full path (replace slashes with dashes)
      const pathSlug = normalizedPath.replace(/\//g, '-');
      slug = `${slug}-${pathSlug}`;
    }
  }

  return slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

/**
 * Check if a slug already exists in the database
 * Used for collision detection when generating slugs
 */
export async function checkSlugCollision(
  db: D1Database,
  slug: string,
  excludeSkillId?: string
): Promise<boolean> {
  const query = excludeSkillId
    ? 'SELECT id FROM skills WHERE slug = ? AND id != ? LIMIT 1'
    : 'SELECT id FROM skills WHERE slug = ? LIMIT 1';

  const result = excludeSkillId
    ? await db.prepare(query).bind(slug, excludeSkillId).first()
    : await db.prepare(query).bind(slug).first();

  return result !== null;
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

// ============================================
// File Tree Utilities
// ============================================

import type { FileNode, DirectoryFile } from './types';

/**
 * Convert flat file list to tree structure for frontend display
 */
export function buildFileTree(files: DirectoryFile[]): FileNode[] {
  const root: FileNode[] = [];
  const nodeMap = new Map<string, FileNode>();

  // Sort files by path to ensure parent directories are processed first
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const parts = file.path.split('/');
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!nodeMap.has(currentPath)) {
        const node: FileNode = {
          name: part,
          path: currentPath,
          type: isLast ? 'file' : 'directory',
          ...(isLast && file.size ? { size: file.size } : {}),
        };

        nodeMap.set(currentPath, node);

        if (parentPath) {
          const parent = nodeMap.get(parentPath);
          if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(node);
          }
        } else {
          root.push(node);
        }
      }
    }
  }

  // Sort children: directories first, then files, alphabetically
  function sortChildren(nodes: FileNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortChildren(node.children);
      }
    }
  }

  sortChildren(root);
  return root;
}
