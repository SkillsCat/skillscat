import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '$lib';

const log = createLogger('Submit');

const GITHUB_API_BASE = 'https://api.github.com';

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

    const body = await request.json() as { url?: string };
    const { url } = body;

    if (!url) {
      throw error(400, 'Repository URL is required');
    }

    // Parse URL
    const repoInfo = parseRepoUrl(url);
    if (!repoInfo) {
      throw error(400, 'Invalid repository URL. Only GitHub repositories are supported.');
    }

    const { owner, repo, path } = repoInfo;

    // Reject submissions from dot folders (IDE-specific configurations)
    if (path && isInDotFolder(path)) {
      throw error(400, 'Skills from IDE-specific folders (e.g., .claude, .cursor, .trae) are not accepted. Please submit standalone skills from the repository root.');
    }

    const db = platform?.env?.DB;
    const queue = platform?.env?.INDEXING_QUEUE;

    // Check if already exists
    if (db) {
      const existing = await db.prepare(`
        SELECT id, slug, tier FROM skills WHERE repo_owner = ? AND repo_name = ?
      `)
        .bind(owner, repo)
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

    // Fetch repository info
    const githubToken = platform?.env?.GITHUB_TOKEN;

    const repoData = await fetchGitHubRepo(owner, repo, githubToken);
    if (!repoData) {
      throw error(404, 'Repository not found');
    }

    if (repoData.fork) {
      throw error(400, 'Forked repositories are not accepted. Please submit the original repository.');
    }

    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken);
    if (!hasSkillMd) {
      throw error(400, 'No SKILL.md file found in the repository');
    }

    // Send to indexing queue
    if (queue) {
      const queueMessage = {
        type: 'check_skill',
        repoOwner: owner,
        repoName: repo,
        skillPath: path,
        submittedBy: session.user.id,
        submittedAt: new Date().toISOString(),
      };
      log.log(`Sending to indexing queue: ${owner}/${repo}`, queueMessage);
      try {
        await queue.send(queueMessage);
        log.log(`Successfully queued for indexing: ${owner}/${repo}, user: ${session.user.id}`);
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
        .bind(crypto.randomUUID(), session.user.id, null, Date.now())
        .run();
    }

    return json({
      success: true,
      message: 'Skill submitted successfully. It will appear in our catalog once processed.',
    });
  } catch (err: any) {
    log.error('Error submitting skill:', err);
    if (err.status) throw err;
    throw error(500, 'Failed to submit skill');
  }
};

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

    // Check if already exists
    if (db) {
      const existing = await db.prepare(`
        SELECT slug, tier FROM skills WHERE repo_owner = ? AND repo_name = ?
      `)
        .bind(owner, repo)
        .first<{ slug: string; tier: string }>();

      if (existing) {
        // If archived, allow submission (will trigger resurrection)
        if (existing.tier === 'archived') {
          return json({
            valid: true,
            owner,
            repo,
            path,
            archived: true,
            existingSlug: existing.slug,
            message: 'This skill is archived and will be resurrected upon submission.',
          });
        }

        return json({
          valid: false,
          error: 'This skill already exists',
          existingSlug: existing.slug,
        });
      }
    }

    // Fetch repository info
    const githubToken = platform?.env?.GITHUB_TOKEN;

    const repoData = await fetchGitHubRepo(owner, repo, githubToken);
    if (!repoData) {
      return json({ valid: false, error: 'Repository not found' });
    }

    if (repoData.fork) {
      return json({ valid: false, error: 'Forked repositories are not accepted' });
    }

    const hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken);
    if (!hasSkillMd) {
      return json({ valid: false, error: 'No SKILL.md file found' });
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
  } catch (err: any) {
    log.error('Error checking URL:', err);
    return json({ valid: false, error: 'Failed to validate URL' });
  }
};
