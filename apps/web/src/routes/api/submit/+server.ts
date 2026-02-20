import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '$lib';
import type { SkillMdLocation, ScanResult } from '$lib/types';
import { githubRequest } from '$lib/server/github-request';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/middleware/auth';

const log = createLogger('Submit');

const GITHUB_API_BASE = 'https://api.github.com';

// Limits for scanning
const MAX_DEPTH = 3;
const MAX_SKILLS_TO_SUBMIT = 50; // Safety limit for auto-submission
const QUEUE_DELAY_MS = 1000; // 1 second delay between queue messages

/** Minimum stars required for a repo to allow dot-folder skills */
const DOT_FOLDER_MIN_STARS = 500;
/** Maximum size for submit request JSON body */
const MAX_SUBMIT_BODY_BYTES = 16 * 1024;
/** Fast-fail policy for token-authenticated submit calls */
const GITHUB_TOKEN_SUBMIT_MAX_RETRIES = 0;
const GITHUB_TOKEN_SUBMIT_MAX_DELAY_MS = 2_000;

type GitHubUpstreamErrorCode = 'github_rate_limited' | 'github_upstream_failure';
type GitHubRequestMode = 'default' | 'token_fast_fail';

class GitHubUpstreamError extends Error {
  readonly code: GitHubUpstreamErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor({
    code,
    status,
    message,
    retryAfterSeconds = null,
  }: {
    code: GitHubUpstreamErrorCode;
    status: number;
    message: string;
    retryAfterSeconds?: number | null;
  }) {
    super(message);
    this.name = 'GitHubUpstreamError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function hasStatus(errorValue: unknown): errorValue is { status: number } {
  if (typeof errorValue !== 'object' || errorValue === null) return false;
  if (!('status' in errorValue)) return false;
  return typeof (errorValue as { status: unknown }).status === 'number';
}

function parseRetryAfterSeconds(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const asSeconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return asSeconds;
    }

    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
    }
  }

  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const epochSeconds = Number.parseInt(reset, 10);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return Math.max(0, epochSeconds - Math.floor(Date.now() / 1000));
    }
  }

  return null;
}

function isGitHubRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;

  const remaining = response.headers.get('x-ratelimit-remaining');
  return remaining === '0' || response.headers.has('retry-after');
}

function toGitHubUpstreamError(response: Response, context: string): GitHubUpstreamError {
  if (isGitHubRateLimited(response)) {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
    const retryHint = retryAfterSeconds !== null ? ` Retry after ${retryAfterSeconds} seconds.` : '';

    return new GitHubUpstreamError({
      code: 'github_rate_limited',
      status: 429,
      message: `GitHub API rate limit reached while ${context}.${retryHint}`,
      retryAfterSeconds,
    });
  }

  const status = response.status >= 500 ? 503 : 502;
  return new GitHubUpstreamError({
    code: 'github_upstream_failure',
    status,
    message: `GitHub API request failed while ${context} (GitHub status ${response.status}). Please retry later.`,
  });
}

function buildGitHubUpstreamResponse(err: GitHubUpstreamError, forValidation: boolean): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
  });

  if (err.retryAfterSeconds !== null) {
    headers.set('Retry-After', String(err.retryAfterSeconds));
  }

  const body: Record<string, string | number | boolean> = forValidation
    ? {
      valid: false,
      error: err.message,
      code: err.code,
    }
    : {
      success: false,
      error: err.message,
      code: err.code,
    };

  if (err.retryAfterSeconds !== null) {
    body.retryAfterSeconds = err.retryAfterSeconds;
  }

  return json(body, { status: err.status, headers });
}

async function githubRequestForSubmit(
  url: string,
  token: string | undefined,
  mode: GitHubRequestMode = 'default'
): Promise<Response> {
  const requestOptions: Parameters<typeof githubRequest>[1] = {
    token,
    userAgent: 'SkillsCat/1.0',
  };

  if (mode === 'token_fast_fail') {
    requestOptions.maxRetries = GITHUB_TOKEN_SUBMIT_MAX_RETRIES;
    requestOptions.maxDelayMs = GITHUB_TOKEN_SUBMIT_MAX_DELAY_MS;
  }

  try {
    return await githubRequest(url, requestOptions);
  } catch (cause) {
    log.error('GitHub request network failure:', { url, cause });
    throw new GitHubUpstreamError({
      code: 'github_upstream_failure',
      status: 503,
      message: 'GitHub API request failed due to an upstream network issue. Please retry later.',
    });
  }
}

interface ArchiveData {
  id: string;
  categories: string[];
  skillMdContent: string | null;
  repo_owner: string;
  repo_name: string;
}

/**
 * Read request body with a hard size limit and parse JSON.
 */
async function readLimitedJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw error(413, 'Request body too large');
    }
  }

  const body = request.body;
  if (!body) {
    throw error(400, 'Request body is required');
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      reader.cancel().catch(() => {});
      throw error(413, 'Request body too large');
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw error(400, 'Invalid JSON body');
  }
}

/**
 * Trigger direct resurrection for user-submitted archived skills
 * No threshold check - user submission is a strong signal
 */
async function triggerDirectResurrection(
  db: D1Database,
  r2: R2Bucket | undefined,
  skillId: string
): Promise<boolean> {
  if (!r2) return false;

  try {
    // Find archive file
    const archiveList = await r2.list({ prefix: 'archive/' });
    let archivePath: string | null = null;

    for (const obj of archiveList.objects) {
      if (obj.key.includes(skillId)) {
        archivePath = obj.key;
        break;
      }
    }

    if (!archivePath) {
      // No archive found, just update tier to cold
      const now = Date.now();
      await db.prepare(`
        UPDATE skills SET tier = 'cold', last_accessed_at = ?, updated_at = ? WHERE id = ?
      `).bind(now, now, skillId).run();
      return true;
    }

    // Get archive data
    const archiveObj = await r2.get(archivePath);
    if (!archiveObj) return false;

    const archiveData = await archiveObj.json() as ArchiveData;

    // Restore SKILL.md to R2
    if (archiveData.skillMdContent) {
      const skillMdPath = `skills/${archiveData.repo_owner}/${archiveData.repo_name}/SKILL.md`;
      await r2.put(skillMdPath, archiveData.skillMdContent, {
        httpMetadata: { contentType: 'text/markdown' },
      });
    }

    // Update skill tier to cold
    const now = Date.now();
    await db.prepare(`
      UPDATE skills SET tier = 'cold', last_accessed_at = ?, updated_at = ? WHERE id = ?
    `).bind(now, now, skillId).run();

    // Restore categories
    for (const categorySlug of archiveData.categories || []) {
      await db.prepare(`
        INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
        VALUES (?, ?)
      `).bind(skillId, categorySlug).run();
    }

    // Delete archive file
    await r2.delete(archivePath);

    return true;
  } catch (err) {
    log.error('Failed to resurrect skill:', err);
    return false;
  }
}

/**
 * Check if a path starts with a dot folder (e.g., .claude/, .cursor/, .trae/)
 * Skills in dot folders are IDE-specific configurations and should not be accepted
 * as standalone skills in the registry.
 */
function isInDotFolder(path: string): boolean {
  return /^\.[\w-]+\//.test(path) || /^\.[\w-]+$/.test(path);
}

/**
 * Get the depth of a path (number of directory levels)
 */
function getPathDepth(path: string): number {
  if (!path) return 0;
  return path.split('/').filter(Boolean).length - 1; // -1 because SKILL.md itself doesn't count
}

/**
 * Get the skill path (parent folder) from a SKILL.md path
 */
function getSkillPath(skillMdPath: string): string {
  const parts = skillMdPath.split('/');
  parts.pop(); // Remove SKILL.md
  return parts.join('/');
}

/**
 * Check if a path contains any dot folder segment
 */
function containsDotFolder(path: string): boolean {
  return path.split('/').some(segment => segment.startsWith('.'));
}

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

/**
 * Scan repository for SKILL.md files using Git Trees API
 * @param basePath - If provided, only scan within this path scope
 */
async function scanRepoForSkillMd(
  owner: string,
  repo: string,
  token?: string,
  basePath: string = '',
  maxDepth: number = MAX_DEPTH,
  allowDotFolders: boolean = false,
  mode: GitHubRequestMode = 'default'
): Promise<ScanResult> {
  try {
    // Use Git Trees API with recursive flag
    const response = await githubRequestForSubmit(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      token,
      mode
    );

    if (response.ok) {
      const data = await response.json() as GitHubTreeResponse;
      const found: SkillMdLocation[] = [];

      // Normalize basePath for comparison
      const normalizedBasePath = basePath ? basePath.replace(/\/$/, '') : '';

      for (const item of data.tree) {
        // Only look at files (blobs)
        if (item.type !== 'blob') continue;

        // Check if it's a SKILL.md file (case-insensitive)
        const fileName = item.path.split('/').pop() || '';
        if (fileName.toLowerCase() !== 'skill.md') continue;

        // Skip files in dot folders (unless allowed for high-star repos)
        if (!allowDotFolders && containsDotFolder(item.path)) continue;

        // If basePath is specified, only include files within that scope
        if (normalizedBasePath) {
          if (!item.path.startsWith(normalizedBasePath + '/') && item.path !== normalizedBasePath + '/SKILL.md') {
            continue;
          }
        }

        // Calculate depth relative to basePath
        const relativePath = normalizedBasePath ? item.path.slice(normalizedBasePath.length + 1) : item.path;
        const depth = getPathDepth(relativePath);

        // Skip files beyond max depth (relative to basePath)
        if (depth > maxDepth) continue;

        found.push({
          path: item.path,
          skillPath: getSkillPath(item.path),
          depth,
        });
      }

      // Sort by depth (root first), then alphabetically
      found.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.path.localeCompare(b.path);
      });

      // Limit results for safety
      const truncated = found.length > MAX_SKILLS_TO_SUBMIT || data.truncated;
      const limited = found.slice(0, MAX_SKILLS_TO_SUBMIT);

      return { found: limited, truncated };
    }

    if (isGitHubRateLimited(response)) {
      throw toGitHubUpstreamError(response, `scanning repository tree for ${owner}/${repo}`);
    }

    if (response.status >= 500 || response.status === 401 || response.status === 403) {
      throw toGitHubUpstreamError(response, `scanning repository tree for ${owner}/${repo}`);
    }

    log.warn(`Trees API failed (${response.status}) for ${owner}/${repo}, falling back to Search API`);
  } catch (err) {
    if (err instanceof GitHubUpstreamError) {
      throw err;
    }
    log.warn('Error scanning repo with Trees API, falling back to Search API:', err);
  }

  // Fallback to search API
  return await searchRepoForSkillMd(owner, repo, token, basePath, maxDepth, allowDotFolders, mode);
}

interface GitHubSearchItem {
  name: string;
  path: string;
  repository: {
    full_name: string;
  };
}

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubSearchItem[];
}

/**
 * Fallback: Search repository for SKILL.md files using Search API
 * @param basePath - If provided, only include files within this path scope
 */
async function searchRepoForSkillMd(
  owner: string,
  repo: string,
  token?: string,
  basePath: string = '',
  maxDepth: number = MAX_DEPTH,
  allowDotFolders: boolean = false,
  mode: GitHubRequestMode = 'default'
): Promise<ScanResult> {
  try {
    const query = encodeURIComponent(`filename:SKILL.md repo:${owner}/${repo}`);
    const response = await githubRequestForSubmit(
      `${GITHUB_API_BASE}/search/code?q=${query}&per_page=100`,
      token,
      mode
    );

    if (!response.ok) {
      throw toGitHubUpstreamError(response, `searching SKILL.md files in ${owner}/${repo}`);
    }

    const data = await response.json() as GitHubSearchResponse;
    const found: SkillMdLocation[] = [];

    // Normalize basePath for comparison
    const normalizedBasePath = basePath ? basePath.replace(/\/$/, '') : '';

    for (const item of data.items) {
      // Skip files in dot folders (unless allowed for high-star repos)
      if (!allowDotFolders && containsDotFolder(item.path)) continue;

      // If basePath is specified, only include files within that scope
      if (normalizedBasePath) {
        if (!item.path.startsWith(normalizedBasePath + '/') && item.path !== normalizedBasePath + '/SKILL.md') {
          continue;
        }
      }

      // Calculate depth relative to basePath
      const relativePath = normalizedBasePath ? item.path.slice(normalizedBasePath.length + 1) : item.path;
      const depth = getPathDepth(relativePath);

      // Skip files beyond max depth (relative to basePath)
      if (depth > maxDepth) continue;

      found.push({
        path: item.path,
        skillPath: getSkillPath(item.path),
        depth,
      });
    }

    // Sort by depth (root first), then alphabetically
    found.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.path.localeCompare(b.path);
    });

    // Limit results for safety
    const truncated = found.length > MAX_SKILLS_TO_SUBMIT || data.incomplete_results;
    const limited = found.slice(0, MAX_SKILLS_TO_SUBMIT);

    return { found: limited, truncated };
  } catch (err) {
    if (err instanceof GitHubUpstreamError) {
      throw err;
    }

    log.error('Error searching repo with Search API:', err);
    throw new GitHubUpstreamError({
      code: 'github_upstream_failure',
      status: 503,
      message: 'GitHub code search failed due to an upstream network issue. Please retry later.',
    });
  }
}

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

type GitHubRefType = 'tree' | 'blob' | 'commit';

interface ParsedRepoUrl {
  owner: string;
  repo: string;
  path: string;
  refType?: GitHubRefType;
  refPath?: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  name?: string;
  description?: string;
  stars?: number;
  fork?: boolean;
}

/**
 * Parse repository URL to extract owner/repo and optional ref data (GitHub only)
 */
function parseRepoUrl(url: string): ParsedRepoUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) {
    return null;
  }

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));

  if (segments.length < 2) {
    return null;
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');

  if (!owner || !repo) {
    return null;
  }

  if (segments.length === 2) {
    return { owner, repo, path: '' };
  }

  const route = segments[2];
  if (route === 'tree' || route === 'blob' || route === 'commit') {
    return {
      owner,
      repo,
      path: '',
      refType: route,
      refPath: segments.slice(3).join('/'),
    };
  }

  return {
    owner,
    repo,
    path: segments.slice(2).join('/'),
  };
}

/**
 * Resolve submitted path from parsed URL and enforce default-branch-only policy.
 */
function resolveSubmittedPath(parsedUrl: ParsedRepoUrl, defaultBranch: string): { path: string } | { error: string } {
  if (!parsedUrl.refType) {
    return { path: parsedUrl.path };
  }

  if (!parsedUrl.refPath) {
    return {
      error: `Invalid GitHub URL format. Please use the repository root or the default branch (${defaultBranch}).`,
    };
  }

  if (parsedUrl.refType === 'commit') {
    return {
      error: `Commit-specific URLs are not supported. Please submit using the repository root or the default branch (${defaultBranch}).`,
    };
  }

  const defaultBranchPrefix = `${defaultBranch}/`;
  const matchesDefaultBranch =
    parsedUrl.refPath === defaultBranch || parsedUrl.refPath.startsWith(defaultBranchPrefix);

  if (!matchesDefaultBranch) {
    return {
      error: `Only the default branch (${defaultBranch}) is supported for submission.`,
    };
  }

  const relativePath = parsedUrl.refPath === defaultBranch
    ? ''
    : parsedUrl.refPath.slice(defaultBranch.length + 1);

  if (parsedUrl.refType === 'blob') {
    const parts = relativePath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return { path: '' };
    }
    parts.pop();
    return { path: parts.join('/') };
  }

  return { path: relativePath };
}

/**
 * Fetch repository info from GitHub
 */
async function fetchGitHubRepo(
  owner: string,
  repo: string,
  token?: string,
  mode: GitHubRequestMode = 'default'
): Promise<RepoInfo | null> {
  const response = await githubRequestForSubmit(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
    token,
    mode
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw toGitHubUpstreamError(response, `looking up repository ${owner}/${repo}`);
  }

  const data = await response.json() as {
    name?: string;
    description?: string;
    stargazers_count?: number;
    fork?: boolean;
    default_branch?: string;
  };

  return {
    owner,
    repo,
    defaultBranch: data.default_branch || 'main',
    name: data.name,
    description: data.description || undefined,
    stars: data.stargazers_count,
    fork: data.fork
  };
}

/**
 * Check if SKILL.md exists in GitHub repo (only in root, not in dot folders)
 */
async function checkGitHubSkillMd(
  owner: string,
  repo: string,
  path: string,
  token?: string,
  allowDotFolders: boolean = false,
  mode: GitHubRequestMode = 'default'
): Promise<boolean> {
  // Only check root SKILL.md (skip dot folders unless allowed for high-star repos)
  const skillPaths = [
    path ? `${path}/SKILL.md` : 'SKILL.md',
  ].filter(p => allowDotFolders || !isInDotFolder(p));

  for (const checkPath of skillPaths) {
    const response = await githubRequestForSubmit(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${checkPath}`,
      token,
      mode
    );

    if (response.ok) return true;
    if (response.status !== 404) {
      throw toGitHubUpstreamError(response, `checking ${checkPath} in ${owner}/${repo}`);
    }
  }

  return false;
}

/**
 * POST /api/submit - Submit a Skill
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  try {
    const db = platform?.env?.DB;
    const queue = platform?.env?.INDEXING_QUEUE;
    const githubToken = platform?.env?.GITHUB_TOKEN;

    if (!db) {
      throw error(500, 'Database not available');
    }

    // Support both session auth and API token auth
    const auth = await getAuthContext(request, locals, db);
    if (!auth.userId || !auth.user) {
      throw error(401, 'Please sign in to submit a skill');
    }
    requireSubmitPublishScope(auth);
    const githubRequestMode: GitHubRequestMode = auth.authMethod === 'token' ? 'token_fast_fail' : 'default';

    const body = await readLimitedJsonBody(request, MAX_SUBMIT_BODY_BYTES) as { url?: string; skillPath?: string };
    const { url, skillPath: explicitSkillPath } = body;

    if (!url) {
      throw error(400, 'Repository URL is required');
    }

    // Parse URL
    const repoInfo = parseRepoUrl(url);
    if (!repoInfo) {
      throw error(400, 'Invalid repository URL. Only GitHub repositories are supported.');
    }

    const { owner, repo } = repoInfo;

    // Fetch repository info first
    const repoData = await fetchGitHubRepo(owner, repo, githubToken, githubRequestMode);
    if (!repoData) {
      throw error(404, 'Repository not found');
    }

    if (repoData.fork) {
      throw error(400, 'Forked repositories are not accepted. Please submit the original repository.');
    }

    const resolvedPath = resolveSubmittedPath(repoInfo, repoData.defaultBranch);
    if ('error' in resolvedPath) {
      throw error(400, resolvedPath.error);
    }

    // Use explicit skillPath if provided, otherwise use path from URL
    const path = explicitSkillPath !== undefined ? explicitSkillPath : resolvedPath.path;

    // Reject dot-folder submissions from repos with insufficient stars
    const allowDotFolders = (repoData.stars ?? 0) >= DOT_FOLDER_MIN_STARS;
    if (path && isInDotFolder(path) && !allowDotFolders) {
      throw error(400, 'Skills from IDE-specific folders are only accepted from repositories with 500+ stars.');
    }

    // First, check if SKILL.md exists at the submitted path (or root if no path)
    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken, allowDotFolders, githubRequestMode);

    if (hasSkillMd) {
      // SKILL.md found at the submitted path - submit directly
      return await submitSingleSkill({
        owner,
        repo,
        path,
        userId: auth.userId,
        db,
        queue,
        platform,
      });
    }

    // No SKILL.md at submitted path - scan for SKILL.md files as fallback
    const scanResult = await scanRepoForSkillMd(owner, repo, githubToken, path, MAX_DEPTH, allowDotFolders, githubRequestMode);

    if (scanResult.found.length === 0) {
      throw error(400, 'No SKILL.md file found in the repository');
    }

    // Auto-submit all found skills
    return await submitMultipleSkills({
      owner,
      repo,
      skills: scanResult.found,
      truncated: scanResult.truncated,
      userId: auth.userId,
      db,
      queue,
      platform,
    });
  } catch (err: unknown) {
    if (err instanceof GitHubUpstreamError) {
      log.warn('GitHub upstream error while submitting skill:', err.message);
      return buildGitHubUpstreamResponse(err, false);
    }

    log.error('Error submitting skill:', err);
    if (hasStatus(err)) throw err;
    throw error(500, 'Failed to submit skill');
  }
};

/**
 * Submit multiple skills to the indexing queue with delays
 */
async function submitMultipleSkills({
  owner,
  repo,
  skills,
  truncated,
  userId,
  db,
  queue,
  platform,
}: {
  owner: string;
  repo: string;
  skills: SkillMdLocation[];
  truncated: boolean;
  userId: string;
  db: D1Database | undefined;
  queue: Queue | undefined;
  platform: App.Platform | undefined;
}): Promise<Response> {
  if (!queue) {
    log.error(`INDEXING_QUEUE not available for ${owner}/${repo}`);
    throw error(500, 'Indexing queue not configured');
  }

  const results: { path: string; status: 'queued' | 'exists' | 'failed'; slug?: string }[] = [];

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const skillPath = skill.skillPath;

    try {
      // Check if already exists
      if (db) {
        const existing = await db.prepare(`
          SELECT slug, tier FROM skills
          WHERE repo_owner = ? AND repo_name = ?
          AND COALESCE(skill_path, '') = ?
        `)
          .bind(owner, repo, skillPath || '')
          .first<{ slug: string; tier: string }>();

        if (existing && existing.tier !== 'archived') {
          results.push({ path: skill.path, status: 'exists', slug: existing.slug });
          continue;
        }

        // If archived, we'll let it be resurrected through the queue
      }

      // Send to indexing queue with delay
      const queueMessage = {
        type: 'check_skill',
        repoOwner: owner,
        repoName: repo,
        skillPath: skillPath,
        submittedBy: userId,
        submittedAt: new Date().toISOString(),
      };

      // Use delaySeconds for staggered processing (Cloudflare Queues supports this)
      const delaySeconds = i * Math.ceil(QUEUE_DELAY_MS / 1000);
      await queue.send(queueMessage, { delaySeconds });

      results.push({ path: skill.path, status: 'queued' });
      log.log(`Queued skill ${i + 1}/${skills.length}: ${owner}/${repo}/${skillPath || '(root)'}`);
    } catch (err) {
      log.error(`Failed to queue skill: ${owner}/${repo}/${skillPath}`, err);
      results.push({ path: skill.path, status: 'failed' });
    }
  }

  // Record user action
  if (db) {
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, ?, ?, 'submit', ?)
    `)
      .bind(crypto.randomUUID(), userId, null, Date.now())
      .run();
  }

  const queued = results.filter(r => r.status === 'queued').length;
  const existing = results.filter(r => r.status === 'exists').length;
  const failed = results.filter(r => r.status === 'failed').length;

  return json({
    success: queued > 0,
    submitted: queued,
    existing,
    failed,
    truncated,
    results,
    message: `Submitted ${queued} skill${queued !== 1 ? 's' : ''} for processing.${existing > 0 ? ` ${existing} already exist.` : ''}${truncated ? ' Some skills were not included due to limits.' : ''}`,
  });
}

/**
 * Submit a single skill to the indexing queue
 */
async function submitSingleSkill({
  owner,
  repo,
  path,
  userId,
  db,
  queue,
  platform,
}: {
  owner: string;
  repo: string;
  path: string;
  userId: string;
  db: D1Database | undefined;
  queue: Queue | undefined;
  platform: App.Platform | undefined;
}): Promise<Response> {
  // Check if already exists (include skill_path in uniqueness check)
  if (db) {
    const existing = await db.prepare(`
      SELECT id, slug, tier FROM skills
      WHERE repo_owner = ? AND repo_name = ?
      AND COALESCE(skill_path, '') = ?
    `)
      .bind(owner, repo, path || '')
      .first<{ id: string; slug: string; tier: string }>();

    if (existing) {
      // If archived, trigger resurrection (user submit = strong signal, no threshold)
      if (existing.tier === 'archived') {
        const resurrected = await triggerDirectResurrection(db, platform?.env?.R2, existing.id);
        if (resurrected) {
          return json({
            success: true,
            message: 'Skill has been resurrected and is now available.',
            slug: existing.slug,
          });
        }
        // If resurrection failed, still return the existing slug
        return json({
          success: false,
          error: 'This skill is archived but could not be resurrected',
          existingSlug: existing.slug,
        }, { status: 409 });
      }

      return json(
        {
          success: false,
          error: 'This skill already exists',
          existingSlug: existing.slug,
        },
        { status: 409 }
      );
    }
  }

  // Send to indexing queue
  if (queue) {
    const queueMessage = {
      type: 'check_skill',
      repoOwner: owner,
      repoName: repo,
      skillPath: path,
      submittedBy: userId,
      submittedAt: new Date().toISOString(),
    };
    log.log(`Sending to indexing queue: ${owner}/${repo}`, queueMessage);
    try {
      await queue.send(queueMessage);
      log.log(`Successfully queued for indexing: ${owner}/${repo}, user: ${userId}`);
    } catch (queueError) {
      log.error(`Failed to send to indexing queue: ${owner}/${repo}`, queueError);
      throw error(500, 'Failed to queue skill for processing');
    }
  } else {
    log.error(`INDEXING_QUEUE not available for ${owner}/${repo}`);
    throw error(500, 'Indexing queue not configured');
  }

  // Record user action
  if (db) {
    await db.prepare(`
      INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
      VALUES (?, ?, ?, 'submit', ?)
    `)
      .bind(crypto.randomUUID(), userId, null, Date.now())
      .run();
  }

  return json({
    success: true,
    message: 'Skill submitted successfully. It will appear in our catalog once processed.',
  });
}

/**
 * GET /api/submit/check - Check if URL is valid
 */
export const GET: RequestHandler = async ({ platform, url }) => {
  try {
    const repoUrl = url.searchParams.get('url');
    if (!repoUrl) {
      throw error(400, 'URL is required');
    }

    // Parse URL
    const repoInfo = parseRepoUrl(repoUrl);
    if (!repoInfo) {
      return json({ valid: false, error: 'Invalid repository URL. Only GitHub repositories are supported.' });
    }

    const { owner, repo } = repoInfo;

    const db = platform?.env?.DB;
    const githubToken = platform?.env?.GITHUB_TOKEN;

    // Fetch repository info first
    const repoData = await fetchGitHubRepo(owner, repo, githubToken, 'default');
    if (!repoData) {
      return json({ valid: false, error: 'Repository not found' });
    }

    if (repoData.fork) {
      return json({ valid: false, error: 'Forked repositories are not accepted' });
    }

    const resolvedPath = resolveSubmittedPath(repoInfo, repoData.defaultBranch);
    if ('error' in resolvedPath) {
      return json({ valid: false, error: resolvedPath.error });
    }

    const path = resolvedPath.path;

    // Determine if dot-folder skills are allowed based on star count
    const allowDotFolders = (repoData.stars ?? 0) >= DOT_FOLDER_MIN_STARS;

    // First, check if SKILL.md exists at the submitted path (or root if no path)
    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken, allowDotFolders, 'default');

    if (hasSkillMd) {
      // SKILL.md found at the submitted path - check if already exists in DB
      if (db) {
        const existing = await db.prepare(`
          SELECT slug, tier FROM skills
          WHERE repo_owner = ? AND repo_name = ?
          AND COALESCE(skill_path, '') = ?
        `)
          .bind(owner, repo, path || '')
          .first<{ slug: string; tier: string }>();

        if (existing) {
          if (existing.tier === 'archived') {
            return json({
              valid: true,
              owner,
              repo,
              path,
              archived: true,
              existingSlug: existing.slug,
              message: 'This skill is archived and will be resurrected upon submission.',
              repoName: repoData.name,
              description: repoData.description,
              stars: repoData.stars,
            });
          }

          return json({
            valid: false,
            error: 'This skill already exists',
            existingSlug: existing.slug,
          });
        }
      }

      return json({
        valid: true,
        owner,
        repo,
        path,
        repoName: repoData.name,
        description: repoData.description,
        stars: repoData.stars,
      });
    }

    // No SKILL.md at submitted path - scan for SKILL.md files as fallback
    const scanResult = await scanRepoForSkillMd(owner, repo, githubToken, path, MAX_DEPTH, allowDotFolders, 'default');

    if (scanResult.found.length === 0) {
      return json({ valid: false, error: 'No SKILL.md file found in the repository' });
    }

    if (scanResult.found.length > 1) {
      // Multiple SKILL.md files found
      return json({
        valid: true,
        multipleFound: true,
        skills: scanResult.found,
        truncated: scanResult.truncated,
        owner,
        repo,
        repoName: repoData.name,
        description: repoData.description,
        stars: repoData.stars,
      });
    }

    // Single SKILL.md found - check if it already exists
    const singlePath = scanResult.found[0].skillPath;
    if (db) {
      const existing = await db.prepare(`
        SELECT slug, tier FROM skills
        WHERE repo_owner = ? AND repo_name = ?
        AND COALESCE(skill_path, '') = ?
      `)
        .bind(owner, repo, singlePath || '')
        .first<{ slug: string; tier: string }>();

      if (existing) {
        if (existing.tier === 'archived') {
          return json({
            valid: true,
            owner,
            repo,
            path: singlePath,
            archived: true,
            existingSlug: existing.slug,
            message: 'This skill is archived and will be resurrected upon submission.',
            repoName: repoData.name,
            description: repoData.description,
            stars: repoData.stars,
          });
        }

        return json({
          valid: false,
          error: 'This skill already exists',
          existingSlug: existing.slug,
        });
      }
    }

    return json({
      valid: true,
      owner,
      repo,
      path: singlePath,
      repoName: repoData.name,
      description: repoData.description,
      stars: repoData.stars,
    });
  } catch (err: unknown) {
    if (err instanceof GitHubUpstreamError) {
      log.warn('GitHub upstream error while checking URL:', err.message);
      return buildGitHubUpstreamResponse(err, true);
    }

    log.error('Error checking URL:', err);
    return json({ valid: false, error: 'Failed to validate URL' });
  }
};
