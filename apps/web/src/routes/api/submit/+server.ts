import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '$lib';
import {
  formatSubmitApiMessage,
  resolveSubmitApiLocale,
  type SubmitApiMessageDescriptor,
} from '$lib/i18n/submit-api';
import type { SkillMdLocation, ScanResult } from '$lib/types';
import { githubRequest } from '$lib/server/github-client/request';
import { getCached } from '$lib/server/cache';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';

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
/** Fast-fail policy for submit-route GitHub calls (POST submit + GET /check) */
const GITHUB_SUBMIT_FAST_FAIL_MAX_RETRIES = 0;
const GITHUB_SUBMIT_FAST_FAIL_MAX_DELAY_MS = 2_000;
const SUBMIT_CHECK_CACHE_TTL_SECONDS = 60;

type GitHubUpstreamErrorCode = 'github_rate_limited' | 'github_upstream_failure';
type GitHubRequestMode = 'default' | 'submit_fast_fail';
const ANON_CLI_SUBMIT_HEADER = 'x-skillscat-background-submit';
const ANON_CLI_SUBMIT_SENTINEL = 'anonymous_cli';
const SUBMIT_LOCALE_HEADER = 'x-skillscat-locale';

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

class SubmitRouteError extends Error {
  readonly status: number;
  readonly code: string;
  readonly descriptor: SubmitApiMessageDescriptor;
  readonly extraBody: Record<string, string | number | boolean | null | undefined>;

  constructor({
    status,
    code,
    descriptor,
    extraBody = {},
  }: {
    status: number;
    code: string;
    descriptor: SubmitApiMessageDescriptor;
    extraBody?: Record<string, string | number | boolean | null | undefined>;
  }) {
    super(code);
    this.name = 'SubmitRouteError';
    this.status = status;
    this.code = code;
    this.descriptor = descriptor;
    this.extraBody = extraBody;
  }
}

function isSubmitRouteError(errorValue: unknown): errorValue is SubmitRouteError {
  return errorValue instanceof SubmitRouteError;
}

function buildSubmitErrorResponse(
  locale: App.Locals['locale'],
  err: SubmitRouteError,
  forValidation: boolean
): Response {
  const body: Record<string, string | number | boolean | null | undefined> = {
    code: err.code,
    error: formatSubmitApiMessage(locale, err.descriptor),
    ...err.extraBody,
  };

  if (forValidation) {
    body.valid = false;
  } else {
    body.success = false;
  }

  return json(body, {
    status: err.status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function buildSubmitCheckResponseHeaders(): Headers {
  return new Headers({
    'Cache-Control': `private, max-age=${SUBMIT_CHECK_CACHE_TTL_SECONDS}`,
    Vary: `${SUBMIT_LOCALE_HEADER}, Accept-Language, Cookie`,
  });
}

function localizeDescriptor(
  locale: App.Locals['locale'],
  descriptor: SubmitApiMessageDescriptor | undefined
): string | undefined {
  if (!descriptor) return undefined;
  return formatSubmitApiMessage(locale, descriptor);
}

function buildSubmitMultipleMessage(
  locale: App.Locals['locale'],
  queued: number,
  existing: number,
  refreshQueued: number,
  truncated: boolean
): string {
  const parts: string[] = [];

  if (queued > 0) {
    parts.push(formatSubmitApiMessage(locale, {
      key: 'skillsQueued',
      values: { count: queued },
    }));
  }

  if (existing > 0) {
    parts.push(formatSubmitApiMessage(locale, {
      key: 'skillsAlreadyExist',
      values: { count: existing },
    }));
  }

  if (refreshQueued > 0) {
    parts.push(formatSubmitApiMessage(locale, {
      key: 'skillsRefreshQueued',
      values: { count: refreshQueued },
    }));
  }

  if (truncated) {
    parts.push(formatSubmitApiMessage(locale, { key: 'skillsSkippedDueToLimit' }));
  }

  if (parts.length === 0) {
    return formatSubmitApiMessage(locale, { key: 'failedToQueueSkill' });
  }

  return parts.join(' ');
}

const SUBMIT_ON_DEMAND_REFRESH_INTERVALS = {
  hot: 6 * 60 * 60 * 1000,
  warm: 24 * 60 * 60 * 1000,
  cool: 7 * 24 * 60 * 60 * 1000,
  cold: 30 * 24 * 60 * 60 * 1000,
  archived: 0,
} as const;

type SubmitRefreshTier = keyof typeof SUBMIT_ON_DEMAND_REFRESH_INTERVALS;

interface ExistingSkillState {
  id?: string;
  slug: string;
  tier: string;
  next_update_at?: number | null;
  indexed_at?: number | null;
}

interface SubmitResultEntry {
  path: string;
  status: 'queued' | 'exists' | 'failed';
  slug?: string;
  refreshQueued?: boolean;
}

function normalizeSubmitRefreshTier(tier: string | null | undefined): SubmitRefreshTier {
  if (tier === 'hot' || tier === 'warm' || tier === 'cool' || tier === 'cold' || tier === 'archived') {
    return tier;
  }
  return 'cold';
}

function shouldQueueExistingSkillRefreshOnSubmit(
  existing: Pick<ExistingSkillState, 'tier' | 'next_update_at' | 'indexed_at'>,
  now: number = Date.now()
): boolean {
  const tier = normalizeSubmitRefreshTier(existing.tier);
  if (tier === 'archived') {
    return false;
  }

  const interval = SUBMIT_ON_DEMAND_REFRESH_INTERVALS[tier];
  if (!interval) {
    return false;
  }

  if (typeof existing.next_update_at === 'number') {
    return existing.next_update_at <= now;
  }

  if (typeof existing.indexed_at !== 'number') {
    return true;
  }

  return now - existing.indexed_at >= interval;
}

function buildSubmitQueueMessage(
  owner: string,
  repo: string,
  skillPath: string,
  userId: string | null
) {
  return {
    type: 'check_skill' as const,
    repoOwner: owner,
    repoName: repo,
    skillPath,
    submittedBy: userId ?? ANON_CLI_SUBMIT_SENTINEL,
    submittedAt: new Date().toISOString(),
  };
}

async function tryQueueExistingSkillRefresh(
  queue: Queue | undefined,
  owner: string,
  repo: string,
  skillPath: string,
  userId: string | null
): Promise<boolean> {
  if (!queue) return false;

  try {
    await queue.send(buildSubmitQueueMessage(owner, repo, skillPath, userId));
    log.log(`Queued refresh check for existing skill: ${owner}/${repo}/${skillPath || '(root)'}`);
    return true;
  } catch (queueError) {
    log.error(`Failed to queue refresh check for existing skill: ${owner}/${repo}/${skillPath || '(root)'}`, queueError);
    return false;
  }
}

function localizeSubmitCheckPayload(
  locale: App.Locals['locale'],
  payload: SubmitCheckPayload
): SubmitCheckPayload {
  const localized: SubmitCheckPayload = { ...payload };
  const errorText = localizeDescriptor(locale, payload.errorDescriptor);
  const messageText = localizeDescriptor(locale, payload.messageDescriptor);

  if (errorText) {
    localized.error = errorText;
  }

  if (messageText) {
    localized.message = messageText;
  }

  delete localized.errorDescriptor;
  delete localized.messageDescriptor;

  return localized;
}

function isSkillscatCliUserAgent(ua: string | null): boolean {
  return /\bskillscat-cli\/\d/i.test((ua || '').trim());
}

function isAnonymousCliBackgroundSubmit(request: Request): boolean {
  return request.headers.get(ANON_CLI_SUBMIT_HEADER) === '1'
    && isSkillscatCliUserAgent(request.headers.get('user-agent'))
    && !request.headers.get('authorization');
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

    return new GitHubUpstreamError({
      code: 'github_rate_limited',
      status: 429,
      message: `GitHub rate limit hit while ${context}.`,
      retryAfterSeconds,
    });
  }

  const status = response.status >= 500 ? 503 : 502;
  return new GitHubUpstreamError({
    code: 'github_upstream_failure',
    status,
    message: `GitHub request failed while ${context}.`,
  });
}

function buildGitHubUpstreamResponse(
  locale: App.Locals['locale'],
  err: GitHubUpstreamError,
  forValidation: boolean
): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
  });

  if (err.retryAfterSeconds !== null) {
    headers.set('Retry-After', String(err.retryAfterSeconds));
  }

  const body: Record<string, string | number | boolean> = forValidation
    ? {
      valid: false,
      error: formatSubmitApiMessage(locale, err.retryAfterSeconds !== null
        ? {
          key: 'githubRateLimitedWithRetryAfter',
          values: { retryAfterSeconds: err.retryAfterSeconds },
        }
        : {
          key: err.code === 'github_rate_limited' ? 'githubRateLimited' : 'githubUpstreamFailure',
        }),
      code: err.code,
    }
    : {
      success: false,
      error: formatSubmitApiMessage(locale, err.retryAfterSeconds !== null
        ? {
          key: 'githubRateLimitedWithRetryAfter',
          values: { retryAfterSeconds: err.retryAfterSeconds },
        }
        : {
          key: err.code === 'github_rate_limited' ? 'githubRateLimited' : 'githubUpstreamFailure',
        }),
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

  if (mode === 'submit_fast_fail') {
    requestOptions.maxRetries = GITHUB_SUBMIT_FAST_FAIL_MAX_RETRIES;
    requestOptions.maxDelayMs = GITHUB_SUBMIT_FAST_FAIL_MAX_DELAY_MS;
  }

  try {
    return await githubRequest(url, requestOptions);
  } catch (cause) {
    log.error('GitHub request network failure:', { url, cause });
    throw new GitHubUpstreamError({
      code: 'github_upstream_failure',
      status: 503,
      message: 'GitHub request failed due to an upstream network issue.',
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
      throw new SubmitRouteError({
        status: 413,
        code: 'request_body_too_large',
        descriptor: { key: 'requestBodyTooLarge' },
      });
    }
  }

  const body = request.body;
  if (!body) {
    throw new SubmitRouteError({
      status: 400,
      code: 'request_body_required',
      descriptor: { key: 'requestBodyRequired' },
    });
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
      throw new SubmitRouteError({
        status: 413,
        code: 'request_body_too_large',
        descriptor: { key: 'requestBodyTooLarge' },
      });
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
    throw new SubmitRouteError({
      status: 400,
      code: 'invalid_json_body',
      descriptor: { key: 'invalidJsonBody' },
    });
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

interface ForkParentInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  fullName: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  name?: string;
  description?: string;
  stars?: number;
  fork?: boolean;
  parent?: ForkParentInfo | null;
}

interface ForkCompareInfo {
  status: 'ahead' | 'behind' | 'identical' | 'diverged';
  aheadBy: number;
  behindBy: number;
}

interface SubmitValidationFailure {
  status: number;
  code: string;
  descriptor: SubmitApiMessageDescriptor;
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
function resolveSubmittedPath(
  parsedUrl: ParsedRepoUrl,
  defaultBranch: string
): { path: string } | SubmitValidationFailure {
  if (!parsedUrl.refType) {
    return { path: parsedUrl.path };
  }

  if (!parsedUrl.refPath) {
    return {
      status: 400,
      code: 'invalid_github_url_format',
      descriptor: {
        key: 'invalidGitHubUrlFormat',
        values: { defaultBranch },
      },
    };
  }

  if (parsedUrl.refType === 'commit') {
    return {
      status: 400,
      code: 'commit_specific_url_not_supported',
      descriptor: {
        key: 'commitSpecificUrlNotSupported',
        values: { defaultBranch },
      },
    };
  }

  const defaultBranchPrefix = `${defaultBranch}/`;
  const matchesDefaultBranch =
    parsedUrl.refPath === defaultBranch || parsedUrl.refPath.startsWith(defaultBranchPrefix);

  if (!matchesDefaultBranch) {
    return {
      status: 400,
      code: 'default_branch_only_supported',
      descriptor: {
        key: 'defaultBranchOnlySupported',
        values: { defaultBranch },
      },
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
    parent?: {
      name?: string;
      default_branch?: string;
      owner?: {
        login?: string;
      };
      full_name?: string;
    } | null;
  };

  const parentOwner = data.parent?.owner?.login;
  const parentRepo = data.parent?.name;

  return {
    owner,
    repo,
    defaultBranch: data.default_branch || 'main',
    name: data.name,
    description: data.description || undefined,
    stars: data.stargazers_count,
    fork: data.fork,
    parent: parentOwner && parentRepo
      ? {
        owner: parentOwner,
        repo: parentRepo,
        defaultBranch: data.parent?.default_branch || 'main',
        fullName: data.parent?.full_name || `${parentOwner}/${parentRepo}`,
      }
      : null,
  };
}

async function fetchForkCompareInfo(
  repo: RepoInfo,
  token?: string,
  mode: GitHubRequestMode = 'default'
): Promise<ForkCompareInfo | null> {
  if (!repo.parent) {
    return null;
  }

  const basehead = `${repo.parent.owner}:${repo.parent.defaultBranch}...${repo.owner}:${repo.defaultBranch}`;
  const response = await githubRequestForSubmit(
    `${GITHUB_API_BASE}/repos/${repo.parent.owner}/${repo.parent.repo}/compare/${encodeURIComponent(basehead)}`,
    token,
    mode
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw toGitHubUpstreamError(response, `comparing fork ${repo.owner}/${repo.repo} with upstream ${repo.parent.fullName}`);
  }

  const data = await response.json() as {
    status?: 'ahead' | 'behind' | 'identical' | 'diverged';
    ahead_by?: number;
    behind_by?: number;
  };

  return {
    status: data.status || 'identical',
    aheadBy: data.ahead_by ?? 0,
    behindBy: data.behind_by ?? 0,
  };
}

async function validateForkSubmission(
  repo: RepoInfo,
  token?: string,
  mode: GitHubRequestMode = 'default'
): Promise<SubmitValidationFailure | null> {
  if (!repo.fork) {
    return null;
  }

  const compareInfo = await fetchForkCompareInfo(repo, token, mode);
  if (!compareInfo || !repo.parent) {
    return {
      status: 503,
      code: 'fork_verification_failed',
      descriptor: { key: 'forkVerificationFailed' },
    };
  }

  if (compareInfo.behindBy > 0 || compareInfo.status === 'behind' || compareInfo.status === 'diverged') {
    return {
      status: 400,
      code: 'fork_behind_upstream',
      descriptor: {
        key: 'forkBehindUpstream',
        values: {
          upstream: repo.parent.fullName,
          behind: compareInfo.behindBy,
        },
      },
    };
  }

  if (compareInfo.aheadBy <= 0 || compareInfo.status === 'identical') {
    return {
      status: 400,
      code: 'fork_no_unique_commits',
      descriptor: {
        key: 'forkNoUniqueCommits',
        values: {
          upstream: repo.parent.fullName,
        },
      },
    };
  }

  return null;
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
  const locale = resolveSubmitApiLocale(request, locals.locale);

  try {
    const db = platform?.env?.DB;
    const queue = platform?.env?.INDEXING_QUEUE;
    const githubToken = platform?.env?.GITHUB_TOKEN;

    if (!db) {
      throw new SubmitRouteError({
        status: 500,
        code: 'database_unavailable',
        descriptor: { key: 'databaseNotAvailable' },
      });
    }

    // Support authenticated submissions and anonymous CLI background submissions.
    const auth = await getAuthContext(request, locals, db);
    const anonymousCliBackgroundSubmit = isAnonymousCliBackgroundSubmit(request);
    let submitterUserId: string | null = null;

    if (auth.userId && auth.user) {
      requireSubmitPublishScope(auth);
      submitterUserId = auth.userId;
    } else if (!anonymousCliBackgroundSubmit) {
      throw new SubmitRouteError({
        status: 401,
        code: 'auth_required',
        descriptor: { key: 'authRequired' },
      });
    }

    const githubRequestMode: GitHubRequestMode = 'submit_fast_fail';

    const body = await readLimitedJsonBody(request, MAX_SUBMIT_BODY_BYTES) as { url?: string; skillPath?: string };
    const { url, skillPath: explicitSkillPath } = body;

    if (!url) {
      throw new SubmitRouteError({
        status: 400,
        code: 'repository_url_required',
        descriptor: { key: 'repositoryUrlRequired' },
      });
    }

    // Parse URL
    const repoInfo = parseRepoUrl(url);
    if (!repoInfo) {
      throw new SubmitRouteError({
        status: 400,
        code: 'invalid_repository_url',
        descriptor: { key: 'invalidRepositoryUrl' },
      });
    }

    const { owner, repo } = repoInfo;

    // Fetch repository info first
    const repoData = await fetchGitHubRepo(owner, repo, githubToken, githubRequestMode);
    if (!repoData) {
      throw new SubmitRouteError({
        status: 404,
        code: 'repository_not_found',
        descriptor: { key: 'repositoryNotFound' },
      });
    }

    const forkValidation = await validateForkSubmission(repoData, githubToken, githubRequestMode);
    if (forkValidation) {
      throw new SubmitRouteError(forkValidation);
    }

    const resolvedPath = resolveSubmittedPath(repoInfo, repoData.defaultBranch);
    if ('descriptor' in resolvedPath) {
      throw new SubmitRouteError(resolvedPath);
    }

    // Use explicit skillPath if provided, otherwise use path from URL
    const path = explicitSkillPath !== undefined ? explicitSkillPath : resolvedPath.path;

    // Reject dot-folder submissions from repos with insufficient stars
    const allowDotFolders = (repoData.stars ?? 0) >= DOT_FOLDER_MIN_STARS;
    if (path && isInDotFolder(path) && !allowDotFolders) {
      throw new SubmitRouteError({
        status: 400,
        code: 'dot_folder_requires_stars',
        descriptor: { key: 'dotFolderRequiresStars' },
      });
    }

    // First, check if SKILL.md exists at the submitted path (or root if no path)
    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken, allowDotFolders, githubRequestMode);

    if (hasSkillMd) {
      // SKILL.md found at the submitted path - submit directly
      return await submitSingleSkill({
        owner,
        repo,
        path,
        userId: submitterUserId,
        db,
        queue,
        platform,
        locale,
      });
    }

    // No SKILL.md at submitted path - scan for SKILL.md files as fallback
    const scanResult = await scanRepoForSkillMd(owner, repo, githubToken, path, MAX_DEPTH, allowDotFolders, githubRequestMode);

    if (scanResult.found.length === 0) {
      throw new SubmitRouteError({
        status: 400,
        code: 'no_skill_md_found',
        descriptor: { key: 'noSkillMdFound' },
      });
    }

    // Auto-submit all found skills
    return await submitMultipleSkills({
      owner,
      repo,
      skills: scanResult.found,
      truncated: scanResult.truncated,
      userId: submitterUserId,
      db,
      queue,
      platform,
      locale,
    });
  } catch (err: unknown) {
    if (err instanceof GitHubUpstreamError) {
      log.warn('GitHub upstream error while submitting skill:', err.message);
      return buildGitHubUpstreamResponse(locale, err, false);
    }

    if (isSubmitRouteError(err)) {
      log.warn('Submit validation failed:', {
        code: err.code,
        status: err.status,
      });
      return buildSubmitErrorResponse(locale, err, false);
    }

    log.error('Error submitting skill:', err);
    return json({
      success: false,
      code: 'submit_failed',
      error: formatSubmitApiMessage(locale, { key: 'submitFailed' }),
    }, {
      status: 500,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
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
  locale,
}: {
  owner: string;
  repo: string;
  skills: SkillMdLocation[];
  truncated: boolean;
  userId: string | null;
  db: D1Database | undefined;
  queue: Queue | undefined;
  platform: App.Platform | undefined;
  locale: App.Locals['locale'];
}): Promise<Response> {
  if (!queue) {
    log.error(`INDEXING_QUEUE not available for ${owner}/${repo}`);
    throw new SubmitRouteError({
      status: 500,
      code: 'indexing_queue_not_configured',
      descriptor: { key: 'indexingQueueNotConfigured' },
    });
  }

  const results: SubmitResultEntry[] = [];
  const now = Date.now();

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    const skillPath = skill.skillPath;

    try {
      // Check if already exists
      if (db) {
        const existing = await db.prepare(`
          SELECT slug, tier, next_update_at, indexed_at FROM skills
          WHERE repo_owner = ? AND repo_name = ?
          AND COALESCE(skill_path, '') = ?
        `)
          .bind(owner, repo, skillPath || '')
          .first<ExistingSkillState>();

        if (existing && existing.tier !== 'archived') {
          const refreshQueued = shouldQueueExistingSkillRefreshOnSubmit(existing, now)
            ? await tryQueueExistingSkillRefresh(queue, owner, repo, skillPath, userId)
            : false;

          results.push({
            path: skill.path,
            status: 'exists',
            slug: existing.slug,
            refreshQueued,
          });
          continue;
        }

        // If archived, we'll let it be resurrected through the queue
      }

      // Send to indexing queue with delay
      // Use delaySeconds for staggered processing (Cloudflare Queues supports this)
      const delaySeconds = i * Math.ceil(QUEUE_DELAY_MS / 1000);
      await queue.send(buildSubmitQueueMessage(owner, repo, skillPath, userId), { delaySeconds });

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
  const refreshQueued = results.filter(r => r.refreshQueued).length;
  const failed = results.filter(r => r.status === 'failed').length;

  return json({
    success: queued > 0 || existing > 0,
    submitted: queued,
    existing,
    refreshQueued,
    failed,
    truncated,
    results,
    message: buildSubmitMultipleMessage(locale, queued, existing, refreshQueued, truncated),
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
  locale,
}: {
  owner: string;
  repo: string;
  path: string;
  userId: string | null;
  db: D1Database | undefined;
  queue: Queue | undefined;
  platform: App.Platform | undefined;
  locale: App.Locals['locale'];
}): Promise<Response> {
  const resultPath = path ? `${path}/SKILL.md` : 'SKILL.md';
  const now = Date.now();

  // Check if already exists (include skill_path in uniqueness check)
  if (db) {
    const existing = await db.prepare(`
      SELECT id, slug, tier, next_update_at, indexed_at FROM skills
      WHERE repo_owner = ? AND repo_name = ?
      AND COALESCE(skill_path, '') = ?
    `)
      .bind(owner, repo, path || '')
      .first<ExistingSkillState>();

    if (existing) {
      // If archived, trigger resurrection (user submit = strong signal, no threshold)
      if (existing.tier === 'archived') {
        if (!existing.id) {
          return json({
            success: false,
            code: 'skill_archived_resurrection_failed',
            error: formatSubmitApiMessage(locale, { key: 'skillArchivedResurrectionFailed' }),
            existingSlug: existing.slug,
          }, { status: 409 });
        }

        const resurrected = await triggerDirectResurrection(db, platform?.env?.R2, existing.id);
        if (resurrected) {
          return json({
            success: true,
            message: formatSubmitApiMessage(locale, { key: 'skillResurrected' }),
            slug: existing.slug,
          });
        }
        // If resurrection failed, still return the existing slug
        return json({
          success: false,
          code: 'skill_archived_resurrection_failed',
          error: formatSubmitApiMessage(locale, { key: 'skillArchivedResurrectionFailed' }),
          existingSlug: existing.slug,
        }, { status: 409 });
      }

      const refreshQueued = shouldQueueExistingSkillRefreshOnSubmit(existing, now)
        ? await tryQueueExistingSkillRefresh(queue, owner, repo, path, userId)
        : false;

      return json(
        {
          success: true,
          submitted: 0,
          existing: 1,
          refreshQueued: refreshQueued ? 1 : 0,
          failed: 0,
          results: [{ path: resultPath, status: 'exists', slug: existing.slug, refreshQueued }],
          message: formatSubmitApiMessage(locale, {
            key: refreshQueued ? 'skillAlreadyExistsRefreshQueued' : 'skillAlreadyExists',
          }),
          existingSlug: existing.slug,
        }
      );
    }
  }

  // Send to indexing queue
  if (queue) {
    const queueMessage = buildSubmitQueueMessage(owner, repo, path, userId);
    log.log(`Sending to indexing queue: ${owner}/${repo}`, queueMessage);
    try {
      await queue.send(queueMessage);
      log.log(`Successfully queued for indexing: ${owner}/${repo}, user: ${userId ?? ANON_CLI_SUBMIT_SENTINEL}`);
    } catch (queueError) {
      log.error(`Failed to send to indexing queue: ${owner}/${repo}`, queueError);
      throw new SubmitRouteError({
        status: 500,
        code: 'failed_to_queue_skill',
        descriptor: { key: 'failedToQueueSkill' },
      });
    }
  } else {
    log.error(`INDEXING_QUEUE not available for ${owner}/${repo}`);
    throw new SubmitRouteError({
      status: 500,
      code: 'indexing_queue_not_configured',
      descriptor: { key: 'indexingQueueNotConfigured' },
    });
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
    submitted: 1,
    existing: 0,
    refreshQueued: 0,
    failed: 0,
    results: [{ path: resultPath, status: 'queued' }],
    message: formatSubmitApiMessage(locale, { key: 'skillSubmitted' }),
  });
}

function buildSubmitCheckCacheKey(repoUrl: string): string {
  return `submit:check:${encodeURIComponent(repoUrl.trim())}`;
}

interface SubmitCheckPayload {
  valid: boolean;
  code?: string;
  error?: string;
  errorDescriptor?: SubmitApiMessageDescriptor;
  owner?: string;
  repo?: string;
  path?: string;
  archived?: boolean;
  existingSlug?: string;
  message?: string;
  messageDescriptor?: SubmitApiMessageDescriptor;
  multipleFound?: boolean;
  skills?: SkillMdLocation[];
  truncated?: boolean;
  repoName?: string;
  description?: string;
  stars?: number;
}

interface ExistingSkillRow {
  slug: string;
  tier: string;
}

async function refreshSubmitCheckExistingState(
  payload: SubmitCheckPayload,
  db?: D1Database
): Promise<SubmitCheckPayload> {
  if (!db || !payload.owner || !payload.repo || payload.multipleFound || typeof payload.path !== 'string') {
    return payload;
  }

  const existing = await db.prepare(`
    SELECT slug, tier FROM skills
    WHERE repo_owner = ? AND repo_name = ?
    AND COALESCE(skill_path, '') = ?
  `)
    .bind(payload.owner, payload.repo, payload.path || '')
    .first<ExistingSkillRow>();

  if (!existing) {
    if (payload.code === 'skill_already_exists' || payload.archived) {
      return {
        valid: true,
        owner: payload.owner,
        repo: payload.repo,
        path: payload.path,
        repoName: payload.repoName,
        description: payload.description,
        stars: payload.stars,
      };
    }
    return payload;
  }

  if (existing.tier === 'archived') {
    return {
      valid: true,
      owner: payload.owner,
      repo: payload.repo,
      path: payload.path,
      archived: true,
      existingSlug: existing.slug,
      code: 'archived_will_be_resurrected',
      messageDescriptor: { key: 'archivedWillBeResurrected' },
      repoName: payload.repoName,
      description: payload.description,
      stars: payload.stars,
    };
  }

  return {
    valid: true,
    code: 'skill_already_exists',
    messageDescriptor: { key: 'skillAlreadyExists' },
    owner: payload.owner,
    repo: payload.repo,
    path: payload.path,
    existingSlug: existing.slug,
    repoName: payload.repoName,
    description: payload.description,
    stars: payload.stars,
  };
}

/**
 * GET /api/submit - Check if URL is valid
 */
export const GET: RequestHandler = async ({ locals, platform, request, url }) => {
  const locale = resolveSubmitApiLocale(request, locals.locale);

  try {
    const repoUrl = url.searchParams.get('url');
    if (!repoUrl) {
      throw new SubmitRouteError({
        status: 400,
        code: 'repository_url_required',
        descriptor: { key: 'repositoryUrlRequired' },
      });
    }
    const cacheKey = buildSubmitCheckCacheKey(repoUrl);
    const { data } = await getCached(
      cacheKey,
      async () => {
        // Parse URL
        const repoInfo = parseRepoUrl(repoUrl);
        if (!repoInfo) {
          return {
            valid: false,
            code: 'invalid_repository_url',
            errorDescriptor: { key: 'invalidRepositoryUrl' },
          } satisfies SubmitCheckPayload;
        }

        const { owner, repo } = repoInfo;

        const db = platform?.env?.DB;
        const githubToken = platform?.env?.GITHUB_TOKEN;

        // Fetch repository info first
        const repoData = await fetchGitHubRepo(owner, repo, githubToken, 'submit_fast_fail');
        if (!repoData) {
          return {
            valid: false,
            code: 'repository_not_found',
            errorDescriptor: { key: 'repositoryNotFound' },
          } satisfies SubmitCheckPayload;
        }

        const forkValidation = await validateForkSubmission(repoData, githubToken, 'submit_fast_fail');
        if (forkValidation) {
          return {
            valid: false,
            code: forkValidation.code,
            errorDescriptor: forkValidation.descriptor,
          } satisfies SubmitCheckPayload;
        }

        const resolvedPath = resolveSubmittedPath(repoInfo, repoData.defaultBranch);
        if ('descriptor' in resolvedPath) {
          return {
            valid: false,
            code: resolvedPath.code,
            errorDescriptor: resolvedPath.descriptor,
          } satisfies SubmitCheckPayload;
        }

        const path = resolvedPath.path;

        // Determine if dot-folder skills are allowed based on star count
        const allowDotFolders = (repoData.stars ?? 0) >= DOT_FOLDER_MIN_STARS;

        // First, check if SKILL.md exists at the submitted path (or root if no path)
        const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken, allowDotFolders, 'submit_fast_fail');

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
                return {
                  valid: true,
                  owner,
                  repo,
                  path,
                  archived: true,
                  code: 'archived_will_be_resurrected',
                  existingSlug: existing.slug,
                  messageDescriptor: { key: 'archivedWillBeResurrected' },
                  repoName: repoData.name,
                  description: repoData.description,
                  stars: repoData.stars,
                } satisfies SubmitCheckPayload;
              }

              return {
                valid: true,
                code: 'skill_already_exists',
                messageDescriptor: { key: 'skillAlreadyExists' },
                owner,
                repo,
                path,
                existingSlug: existing.slug,
                repoName: repoData.name,
                description: repoData.description,
                stars: repoData.stars,
              } satisfies SubmitCheckPayload;
            }
          }

          return {
            valid: true,
            owner,
            repo,
            path,
            repoName: repoData.name,
            description: repoData.description,
            stars: repoData.stars,
          } satisfies SubmitCheckPayload;
        }

        // No SKILL.md at submitted path - scan for SKILL.md files as fallback
        const scanResult = await scanRepoForSkillMd(owner, repo, githubToken, path, MAX_DEPTH, allowDotFolders, 'submit_fast_fail');

        if (scanResult.found.length === 0) {
          return {
            valid: false,
            code: 'no_skill_md_found',
            errorDescriptor: { key: 'noSkillMdFound' },
          } satisfies SubmitCheckPayload;
        }

        if (scanResult.found.length > 1) {
          // Multiple SKILL.md files found
          return {
            valid: true,
            multipleFound: true,
            skills: scanResult.found,
            truncated: scanResult.truncated,
            owner,
            repo,
            repoName: repoData.name,
            description: repoData.description,
            stars: repoData.stars,
          } satisfies SubmitCheckPayload;
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
              return {
                valid: true,
                owner,
                repo,
                path: singlePath,
                archived: true,
                code: 'archived_will_be_resurrected',
                existingSlug: existing.slug,
                messageDescriptor: { key: 'archivedWillBeResurrected' },
                repoName: repoData.name,
                description: repoData.description,
                stars: repoData.stars,
              } satisfies SubmitCheckPayload;
            }

            return {
              valid: true,
              code: 'skill_already_exists',
              messageDescriptor: { key: 'skillAlreadyExists' },
              owner,
              repo,
              path: singlePath,
              existingSlug: existing.slug,
              repoName: repoData.name,
              description: repoData.description,
              stars: repoData.stars,
            } satisfies SubmitCheckPayload;
          }
        }

        return {
          valid: true,
          owner,
          repo,
          path: singlePath,
          repoName: repoData.name,
          description: repoData.description,
          stars: repoData.stars,
        } satisfies SubmitCheckPayload;
      },
      SUBMIT_CHECK_CACHE_TTL_SECONDS
    );

    const responsePayload = localizeSubmitCheckPayload(
      locale,
      await refreshSubmitCheckExistingState(data as SubmitCheckPayload, platform?.env?.DB)
    );

    return json(responsePayload, {
      headers: buildSubmitCheckResponseHeaders(),
    });
  } catch (err: unknown) {
    if (err instanceof GitHubUpstreamError) {
      log.warn('GitHub upstream error while checking URL:', err.message);
      return buildGitHubUpstreamResponse(locale, err, true);
    }

    if (isSubmitRouteError(err)) {
      log.warn('Submit check validation failed:', {
        code: err.code,
        status: err.status,
      });
      return buildSubmitErrorResponse(locale, err, true);
    }

    log.error('Error checking URL:', err);
    return json({
      valid: false,
      code: 'failed_to_validate_url',
      error: formatSubmitApiMessage(locale, { key: 'failedToValidateUrl' }),
    }, {
      headers: buildSubmitCheckResponseHeaders(),
    });
  }
};
