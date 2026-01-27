import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '$lib';
import type { SkillMdLocation, ScanResult } from '$lib/types';

const log = createLogger('Submit');

const GITHUB_API_BASE = 'https://api.github.com';

// Limits for scanning
const MAX_DEPTH = 3;
const MAX_SKILLS_TO_SUBMIT = 50; // Safety limit for auto-submission
const QUEUE_DELAY_MS = 1000; // 1 second delay between queue messages

interface ArchiveData {
  id: string;
  categories: string[];
  skillMdContent: string | null;
  repo_owner: string;
  repo_name: string;
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
  maxDepth: number = MAX_DEPTH
): Promise<ScanResult> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    // Use Git Trees API with recursive flag
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
      { headers }
    );

    if (!response.ok) {
      // Fallback to search API if trees API fails
      return await searchRepoForSkillMd(owner, repo, token, basePath, maxDepth);
    }

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

      // Skip files in dot folders
      if (containsDotFolder(item.path)) continue;

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
  } catch (err) {
    log.error('Error scanning repo with Trees API:', err);
    // Fallback to search API
    return await searchRepoForSkillMd(owner, repo, token, basePath, maxDepth);
  }
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
  maxDepth: number = MAX_DEPTH
): Promise<ScanResult> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const query = encodeURIComponent(`filename:SKILL.md repo:${owner}/${repo}`);
    const response = await fetch(
      `${GITHUB_API_BASE}/search/code?q=${query}&per_page=100`,
      { headers }
    );

    if (!response.ok) {
      return { found: [], truncated: false };
    }

    const data = await response.json() as GitHubSearchResponse;
    const found: SkillMdLocation[] = [];

    // Normalize basePath for comparison
    const normalizedBasePath = basePath ? basePath.replace(/\/$/, '') : '';

    for (const item of data.items) {
      // Skip files in dot folders
      if (containsDotFolder(item.path)) continue;

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
    log.error('Error searching repo with Search API:', err);
    return { found: [], truncated: false };
  }
}

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

interface RepoInfo {
  owner: string;
  repo: string;
  path: string;
  name?: string;
  description?: string;
  stars?: number;
  fork?: boolean;
}

/**
 * Parse repository URL to extract owner, repo, and path (GitHub only)
 */
function parseRepoUrl(url: string): RepoInfo | null {
  // GitHub: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path
  const githubMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/[^\/]+)?(\/.+)?$/);
  if (githubMatch) {
    return {
      owner: githubMatch[1],
      repo: githubMatch[2].replace(/\.git$/, ''),
      path: githubMatch[3]?.slice(1) || ''
    };
  }

  return null;
}

/**
 * Fetch repository info from GitHub
 */
async function fetchGitHubRepo(owner: string, repo: string, token?: string): Promise<RepoInfo | null> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers });
  if (!response.ok) return null;

  const data = await response.json() as {
    name?: string;
    description?: string;
    stargazers_count?: number;
    fork?: boolean;
  };

  return {
    owner,
    repo,
    path: '',
    name: data.name,
    description: data.description || undefined,
    stars: data.stargazers_count,
    fork: data.fork
  };
}

/**
 * Check if SKILL.md exists in GitHub repo (only in root, not in dot folders)
 */
async function checkGitHubSkillMd(owner: string, repo: string, path: string, token?: string): Promise<boolean> {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat/1.0',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Only check root SKILL.md (not in dot folders like .claude/, .cursor/, etc.)
  const skillPaths = [
    path ? `${path}/SKILL.md` : 'SKILL.md',
  ].filter(p => !isInDotFolder(p));

  for (const checkPath of skillPaths) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${checkPath}`,
      { headers }
    );
    if (response.ok) return true;
  }

  return false;
}

/**
 * POST /api/submit - Submit a Skill
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  try {
    // Check if user is logged in
    const session = await locals.auth?.();
    if (!session?.user) {
      throw error(401, 'Please sign in to submit a skill');
    }

    const body = await request.json() as { url?: string; skillPath?: string };
    const { url, skillPath: explicitSkillPath } = body;

    if (!url) {
      throw error(400, 'Repository URL is required');
    }

    // Parse URL
    const repoInfo = parseRepoUrl(url);
    if (!repoInfo) {
      throw error(400, 'Invalid repository URL. Only GitHub repositories are supported.');
    }

    const { owner, repo, path: urlPath } = repoInfo;

    // Use explicit skillPath if provided, otherwise use path from URL
    const path = explicitSkillPath !== undefined ? explicitSkillPath : urlPath;

    // Reject submissions from dot folders (IDE-specific configurations)
    if (path && isInDotFolder(path)) {
      throw error(400, 'Skills from IDE-specific folders (e.g., .claude, .cursor, .trae) are not accepted. Please submit standalone skills from the repository root.');
    }

    const db = platform?.env?.DB;
    const queue = platform?.env?.INDEXING_QUEUE;
    const githubToken = platform?.env?.GITHUB_TOKEN;

    // Fetch repository info first
    const repoData = await fetchGitHubRepo(owner, repo, githubToken);
    if (!repoData) {
      throw error(404, 'Repository not found');
    }

    if (repoData.fork) {
      throw error(400, 'Forked repositories are not accepted. Please submit the original repository.');
    }

    // First, check if SKILL.md exists at the submitted path (or root if no path)
    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken);

    if (hasSkillMd) {
      // SKILL.md found at the submitted path - submit directly
      return await submitSingleSkill({
        owner,
        repo,
        path,
        userId: session.user.id,
        db,
        queue,
        platform,
      });
    }

    // No SKILL.md at submitted path - scan for SKILL.md files as fallback
    const scanResult = await scanRepoForSkillMd(owner, repo, githubToken, path);

    if (scanResult.found.length === 0) {
      throw error(400, 'No SKILL.md file found in the repository');
    }

    // Auto-submit all found skills
    return await submitMultipleSkills({
      owner,
      repo,
      skills: scanResult.found,
      truncated: scanResult.truncated,
      userId: session.user.id,
      db,
      queue,
      platform,
    });
  } catch (err: any) {
    log.error('Error submitting skill:', err);
    if (err.status) throw err;
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
          AND (skill_path = ? OR (skill_path IS NULL AND ? = '') OR (skill_path = '' AND ? = ''))
        `)
          .bind(owner, repo, skillPath || '', skillPath || '', skillPath || '')
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
      AND (skill_path = ? OR (skill_path IS NULL AND ? = '') OR (skill_path = '' AND ? = ''))
    `)
      .bind(owner, repo, path || '', path || '', path || '')
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

    const { owner, repo, path } = repoInfo;

    const db = platform?.env?.DB;
    const githubToken = platform?.env?.GITHUB_TOKEN;

    // Fetch repository info first
    const repoData = await fetchGitHubRepo(owner, repo, githubToken);
    if (!repoData) {
      return json({ valid: false, error: 'Repository not found' });
    }

    if (repoData.fork) {
      return json({ valid: false, error: 'Forked repositories are not accepted' });
    }

    // First, check if SKILL.md exists at the submitted path (or root if no path)
    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken);

    if (hasSkillMd) {
      // SKILL.md found at the submitted path - check if already exists in DB
      if (db) {
        const existing = await db.prepare(`
          SELECT slug, tier FROM skills
          WHERE repo_owner = ? AND repo_name = ?
          AND (skill_path = ? OR (skill_path IS NULL AND ? = '') OR (skill_path = '' AND ? = ''))
        `)
          .bind(owner, repo, path || '', path || '', path || '')
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
    const scanResult = await scanRepoForSkillMd(owner, repo, githubToken, path);

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
        AND (skill_path = ? OR (skill_path IS NULL AND ? = '') OR (skill_path = '' AND ? = ''))
      `)
        .bind(owner, repo, singlePath || '', singlePath || '', singlePath || '')
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
  } catch (err: any) {
    log.error('Error checking URL:', err);
    return json({ valid: false, error: 'Failed to validate URL' });
  }
};
