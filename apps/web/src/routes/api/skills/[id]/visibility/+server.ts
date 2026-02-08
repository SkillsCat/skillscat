import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireScope } from '$lib/server/middleware/auth';
import { isSkillOwner } from '$lib/server/permissions';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Verify that a GitHub repo exists and belongs to the user
 */
async function verifyGitHubRepo(
  repoUrl: string,
  userGithubId: number | null,
  githubToken?: string
): Promise<{ valid: boolean; error?: string }> {
  // Parse GitHub URL
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    return { valid: false, error: 'Invalid GitHub URL' };
  }

  const [, owner, repo] = match;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat/1.0',
  };

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo.replace(/\.git$/, '')}`, { headers });

  if (!response.ok) {
    return { valid: false, error: 'Repository not found or not accessible' };
  }

  const data = await response.json() as {
    owner: { id: number; type: string };
    fork: boolean;
  };

  // Check if repo is owned by the user (not an org)
  if (data.owner.type !== 'User') {
    return { valid: false, error: 'Repository must be owned by a user, not an organization' };
  }

  // Optionally verify the owner matches the user's GitHub ID
  if (userGithubId && data.owner.id !== userGithubId) {
    return { valid: false, error: 'Repository must be owned by you' };
  }

  if (data.fork) {
    return { valid: false, error: 'Forked repositories are not accepted' };
  }

  return { valid: true };
}

/**
 * PUT /api/skills/[id]/visibility - Change skill visibility
 */
export const PUT: RequestHandler = async ({ locals, platform, request, params }) => {
  const db = platform?.env?.DB;
  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'publish');

  const { id: skillId } = params;
  if (!skillId) {
    throw error(400, 'Skill ID is required');
  }

  // Only owner can change visibility
  const isOwner = await isSkillOwner(skillId, auth.userId, db);
  if (!isOwner) {
    throw error(403, 'Only the skill owner can change visibility');
  }

  const body = await request.json() as {
    visibility: 'public' | 'private' | 'unlisted';
    repoUrl?: string;
  };

  const { visibility, repoUrl } = body;

  if (!['public', 'private', 'unlisted'].includes(visibility)) {
    throw error(400, 'Invalid visibility. Must be public, private, or unlisted');
  }

  // Get current skill info
  const skill = await db.prepare(`
    SELECT visibility, source_type, github_url FROM skills WHERE id = ?
  `)
    .bind(skillId)
    .first<{ visibility: string; source_type: string; github_url: string | null }>();

  if (!skill) {
    throw error(404, 'Skill not found');
  }

  // Private to public requires verification
  if (skill.visibility === 'private' && visibility === 'public') {
    // If it's an uploaded skill, require a GitHub repo URL
    if (skill.source_type === 'upload') {
      if (!repoUrl) {
        throw error(400, 'A GitHub repository URL is required to make an uploaded skill public');
      }

      // Get user's GitHub ID for verification
      const account = await db.prepare(`
        SELECT provider_account_id FROM account
        WHERE user_id = ? AND provider_id = 'github'
      `)
        .bind(auth.userId)
        .first<{ provider_account_id: string }>();

      const userGithubId = account ? parseInt(account.provider_account_id, 10) : null;
      const githubToken = platform?.env?.GITHUB_TOKEN;

      const verification = await verifyGitHubRepo(repoUrl, userGithubId, githubToken);
      if (!verification.valid) {
        throw error(400, verification.error!);
      }

      // Update with verified repo URL
      await db.prepare(`
        UPDATE skills
        SET visibility = ?, verified_repo_url = ?, updated_at = ?
        WHERE id = ?
      `)
        .bind(visibility, repoUrl, Date.now(), skillId)
        .run();
    } else {
      // GitHub-sourced skill can be made public directly
      await db.prepare(`
        UPDATE skills SET visibility = ?, updated_at = ? WHERE id = ?
      `)
        .bind(visibility, Date.now(), skillId)
        .run();
    }
  } else {
    // Other visibility changes don't require verification
    await db.prepare(`
      UPDATE skills SET visibility = ?, updated_at = ? WHERE id = ?
    `)
      .bind(visibility, Date.now(), skillId)
      .run();
  }

  return json({
    success: true,
    message: `Skill visibility changed to ${visibility}`,
  });
};
