import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const GITHUB_API_BASE = 'https://api.github.com';

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

/**
 * POST /api/submit - 提交 Skill
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  try {
    // 检查用户是否登录
    const session = await locals.auth?.();
    if (!session?.user) {
      throw error(401, 'Please sign in to submit a skill');
    }

    const body = await request.json() as { url?: string; owner?: string; repo?: string; path?: string };
    const { url, owner, repo, path } = body;

    if (!url || !owner || !repo) {
      throw error(400, 'Invalid GitHub URL');
    }

    // 验证 GitHub URL 格式
    const urlPattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+/;
    if (!urlPattern.test(url)) {
      throw error(400, 'Invalid GitHub URL format');
    }

    const db = platform?.env?.DB;
    const queue = platform?.env?.INDEXING_QUEUE;

    // 检查是否已存在
    if (db) {
      const existing = await db.prepare(`
        SELECT slug FROM skills WHERE repo_owner = ? AND repo_name = ?
      `)
        .bind(owner, repo)
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

    // 验证仓库是否存在且包含 SKILL.md
    const githubToken = platform?.env?.GITHUB_TOKEN;
    const headers: HeadersInit = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SkillsCat/1.0',
    };

    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    // 检查仓库是否存在
    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers });
    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        throw error(404, 'Repository not found');
      }
      throw error(400, 'Failed to fetch repository information');
    }

    const repoData = await repoResponse.json() as { fork?: boolean; name?: string; description?: string; stargazers_count?: number };

    // 检查是否是 fork
    if (repoData.fork) {
      throw error(400, 'Forked repositories are not accepted. Please submit the original repository.');
    }

    // 检查 SKILL.md 是否存在
    const skillPath = path ? `${path}/SKILL.md` : 'SKILL.md';
    const skillMdPaths = [
      skillPath,
      path ? `${path}/.claude/SKILL.md` : '.claude/SKILL.md',
    ];

    let skillMdFound = false;
    for (const checkPath of skillMdPaths) {
      const contentResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${checkPath}`,
        { headers }
      );
      if (contentResponse.ok) {
        skillMdFound = true;
        break;
      }
    }

    if (!skillMdFound) {
      throw error(400, 'No SKILL.md file found in the specified path');
    }

    // 发送到 indexing 队列
    if (queue) {
      await queue.send({
        type: 'check_skill',
        repoOwner: owner,
        repoName: repo,
        skillPath: path || '',
        submittedBy: session.user.id,
        submittedAt: new Date().toISOString(),
      });
    }

    // 记录用户行为
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
    console.error('Error submitting skill:', err);
    if (err.status) throw err;
    throw error(500, 'Failed to submit skill');
  }
};

/**
 * GET /api/submit/check - 检查 URL 是否有效
 */
export const GET: RequestHandler = async ({ platform, url }) => {
  try {
    const githubUrl = url.searchParams.get('url');
    if (!githubUrl) {
      throw error(400, 'URL is required');
    }

    // 解析 GitHub URL
    const match = githubUrl.match(/github\.com\/([\w-]+)\/([\w.-]+)(?:\/tree\/[\w.-]+)?(\/.*)?$/);
    if (!match) {
      return json({ valid: false, error: 'Invalid GitHub URL format' });
    }

    const [, owner, repo, pathPart] = match;
    const path = pathPart?.slice(1) || '';

    const db = platform?.env?.DB;

    // 检查是否已存在
    if (db) {
      const existing = await db.prepare(`
        SELECT slug FROM skills WHERE repo_owner = ? AND repo_name = ?
      `)
        .bind(owner, repo)
        .first<{ slug: string }>();

      if (existing) {
        return json({
          valid: false,
          error: 'This skill already exists',
          existingSlug: existing.slug,
        });
      }
    }

    // 验证仓库
    const githubToken = platform?.env?.GITHUB_TOKEN;
    const headers: HeadersInit = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SkillsCat/1.0',
    };

    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    const repoResponse = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers });
    if (!repoResponse.ok) {
      return json({ valid: false, error: 'Repository not found' });
    }

    const repoData = await repoResponse.json() as { fork?: boolean; name?: string; description?: string; stargazers_count?: number };

    if (repoData.fork) {
      return json({ valid: false, error: 'Forked repositories are not accepted' });
    }

    // 检查 SKILL.md
    const skillPath = path ? `${path}/SKILL.md` : 'SKILL.md';
    const contentResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${skillPath}`,
      { headers }
    );

    if (!contentResponse.ok) {
      // 尝试 .claude/SKILL.md
      const altPath = path ? `${path}/.claude/SKILL.md` : '.claude/SKILL.md';
      const altResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${altPath}`,
        { headers }
      );

      if (!altResponse.ok) {
        return json({ valid: false, error: 'No SKILL.md file found' });
      }
    }

    return json({
      valid: true,
      owner,
      repo,
      path,
      repoName: repoData.name,
      description: repoData.description,
      stars: repoData.stargazers_count,
    });
  } catch (err: any) {
    console.error('Error checking URL:', err);
    return json({ valid: false, error: 'Failed to validate URL' });
  }
};
