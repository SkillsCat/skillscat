import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const GITHUB_API_BASE = 'https://api.github.com';
const GITLAB_API_BASE = 'https://gitlab.com/api/v4';

type Platform = 'github' | 'gitlab';

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

interface RepoInfo {
  platform: Platform;
  owner: string;
  repo: string;
  path: string;
  name?: string;
  description?: string;
  stars?: number;
  fork?: boolean;
}

/**
 * Parse repository URL to extract platform, owner, repo, and path
 */
function parseRepoUrl(url: string): RepoInfo | null {
  // GitHub: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path
  const githubMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/[^\/]+)?(\/.+)?$/);
  if (githubMatch) {
    return {
      platform: 'github',
      owner: githubMatch[1],
      repo: githubMatch[2].replace(/\.git$/, ''),
      path: githubMatch[3]?.slice(1) || ''
    };
  }

  // GitLab: https://gitlab.com/owner/repo or https://gitlab.com/owner/group/repo/-/tree/branch/path
  const gitlabMatch = url.match(/gitlab\.com\/(.+?)(?:\/-\/tree\/[^\/]+)?(\/.+)?$/);
  if (gitlabMatch) {
    const fullPath = gitlabMatch[1];
    // GitLab can have nested groups, so we need to handle owner/group/repo format
    const parts = fullPath.split('/').filter(p => p && !p.startsWith('-'));
    if (parts.length >= 2) {
      // Last part is repo, everything before is owner/group
      const repo = parts.pop()!.replace(/\.git$/, '');
      const owner = parts.join('/');
      return {
        platform: 'gitlab',
        owner,
        repo,
        path: gitlabMatch[2]?.slice(1) || ''
      };
    }
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
    platform: 'github',
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
 * Fetch repository info from GitLab
 */
async function fetchGitLabRepo(owner: string, repo: string, token?: string): Promise<RepoInfo | null> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const headers: HeadersInit = {
    'User-Agent': 'SkillsCat/1.0',
  };

  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  const response = await fetch(`${GITLAB_API_BASE}/projects/${projectPath}`, { headers });
  if (!response.ok) return null;

  const data = await response.json() as {
    name?: string;
    description?: string;
    star_count?: number;
    forked_from_project?: object;
  };

  return {
    platform: 'gitlab',
    owner,
    repo,
    path: '',
    name: data.name,
    description: data.description || undefined,
    stars: data.star_count,
    fork: !!data.forked_from_project
  };
}

/**
 * Check if SKILL.md exists in GitHub repo
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

  const skillPaths = [
    path ? `${path}/SKILL.md` : 'SKILL.md',
    path ? `${path}/.claude/SKILL.md` : '.claude/SKILL.md',
    path ? `${path}/.claude/skills/SKILL.md` : '.claude/skills/SKILL.md',
  ];

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
 * Check if SKILL.md exists in GitLab repo
 */
async function checkGitLabSkillMd(owner: string, repo: string, path: string, token?: string): Promise<boolean> {
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const headers: HeadersInit = {
    'User-Agent': 'SkillsCat/1.0',
  };

  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  const skillPaths = [
    path ? `${path}/SKILL.md` : 'SKILL.md',
    path ? `${path}/.claude/SKILL.md` : '.claude/SKILL.md',
    path ? `${path}/.claude/skills/SKILL.md` : '.claude/skills/SKILL.md',
  ];

  for (const checkPath of skillPaths) {
    const encodedPath = encodeURIComponent(checkPath);
    const response = await fetch(
      `${GITLAB_API_BASE}/projects/${projectPath}/repository/files/${encodedPath}?ref=main`,
      { headers }
    );
    if (response.ok) return true;

    // Try master branch as fallback
    const masterResponse = await fetch(
      `${GITLAB_API_BASE}/projects/${projectPath}/repository/files/${encodedPath}?ref=master`,
      { headers }
    );
    if (masterResponse.ok) return true;
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
      throw error(400, 'Invalid repository URL. Supported platforms: GitHub, GitLab');
    }

    const { platform: repoPlatform, owner, repo, path } = repoInfo;

    const db = platform?.env?.DB;
    const queue = platform?.env?.INDEXING_QUEUE;

    // Check if already exists
    if (db) {
      const existing = await db.prepare(`
        SELECT slug FROM skills WHERE repo_owner = ? AND repo_name = ? AND platform = ?
      `)
        .bind(owner, repo, repoPlatform)
        .first<{ slug: string }>();

      if (existing) {
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
    const gitlabToken = platform?.env?.GITLAB_TOKEN;

    let repoData: RepoInfo | null = null;
    let hasSkillMd = false;

    if (repoPlatform === 'github') {
      repoData = await fetchGitHubRepo(owner, repo, githubToken);
      if (repoData) {
        hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken);
      }
    } else if (repoPlatform === 'gitlab') {
      repoData = await fetchGitLabRepo(owner, repo, gitlabToken);
      if (repoData) {
        hasSkillMd = await checkGitLabSkillMd(owner, repo, path, gitlabToken);
      }
    }

    if (!repoData) {
      throw error(404, 'Repository not found');
    }

    if (repoData.fork) {
      throw error(400, 'Forked repositories are not accepted. Please submit the original repository.');
    }

    if (!hasSkillMd) {
      throw error(400, 'No SKILL.md file found in the repository');
    }

    // Send to indexing queue
    if (queue) {
      await queue.send({
        type: 'check_skill',
        platform: repoPlatform,
        repoOwner: owner,
        repoName: repo,
        skillPath: path,
        submittedBy: session.user.id,
        submittedAt: new Date().toISOString(),
      });
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
      platform: repoPlatform,
    });
  } catch (err: any) {
    console.error('Error submitting skill:', err);
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
      return json({ valid: false, error: 'Invalid repository URL. Supported platforms: GitHub, GitLab' });
    }

    const { platform: repoPlatform, owner, repo, path } = repoInfo;

    const db = platform?.env?.DB;

    // Check if already exists
    if (db) {
      const existing = await db.prepare(`
        SELECT slug FROM skills WHERE repo_owner = ? AND repo_name = ? AND platform = ?
      `)
        .bind(owner, repo, repoPlatform)
        .first<{ slug: string }>();

      if (existing) {
        return json({
          valid: false,
          error: 'This skill already exists',
          existingSlug: existing.slug,
        });
      }
    }

    // Fetch repository info
    const githubToken = platform?.env?.GITHUB_TOKEN;
    const gitlabToken = platform?.env?.GITLAB_TOKEN;

    let repoData: RepoInfo | null = null;
    let hasSkillMd = false;

    if (repoPlatform === 'github') {
      repoData = await fetchGitHubRepo(owner, repo, githubToken);
      if (repoData) {
        hasSkillMd = await checkGitHubSkillMd(owner, repo, path, githubToken);
      }
    } else if (repoPlatform === 'gitlab') {
      repoData = await fetchGitLabRepo(owner, repo, gitlabToken);
      if (repoData) {
        hasSkillMd = await checkGitLabSkillMd(owner, repo, path, gitlabToken);
      }
    }

    if (!repoData) {
      return json({ valid: false, error: 'Repository not found' });
    }

    if (repoData.fork) {
      return json({ valid: false, error: 'Forked repositories are not accepted' });
    }

    if (!hasSkillMd) {
      return json({ valid: false, error: 'No SKILL.md file found' });
    }

    return json({
      valid: true,
      platform: repoPlatform,
      owner,
      repo,
      path,
      repoName: repoData.name,
      description: repoData.description,
      stars: repoData.stars,
    });
  } catch (err: any) {
    console.error('Error checking URL:', err);
    return json({ valid: false, error: 'Failed to validate URL' });
  }
};
