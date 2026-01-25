/**
 * Admin API: Resurrection Check
 *
 * POST /api/admin/resurrection
 * Check and potentially resurrect an archived skill
 *
 * Requires WORKER_SECRET authentication
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

// Threshold for user-triggered resurrection (lower than quarterly batch)
const USER_ACCESS_STAR_THRESHOLD = 20;
const RECENT_ACTIVITY_DAYS = 90;

interface GitHubGraphQLResponse {
  data?: {
    repository?: {
      stargazerCount: number;
      pushedAt: string;
    };
  };
  errors?: Array<{ message: string }>;
}

function isRecentlyActive(pushedAt: string, days: number): boolean {
  const pushedDate = new Date(pushedAt);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return pushedDate > cutoff;
}

async function fetchGitHubRepoData(
  owner: string,
  name: string,
  token: string
): Promise<{ stargazerCount: number; pushedAt: string } | null> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        stargazerCount
        pushedAt
      }
    }
  `;

  try {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { owner, name },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as GitHubGraphQLResponse;
    return data.data?.repository || null;
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request, platform }) => {
  // Verify authentication
  const authHeader = request.headers.get('Authorization');
  const workerSecret = env?.WORKER_SECRET || platform?.env?.WORKER_SECRET;

  if (!workerSecret || authHeader !== `Bearer ${workerSecret}`) {
    throw error(401, 'Unauthorized');
  }

  const db = platform?.env?.DB;
  const githubToken = env?.GITHUB_TOKEN || platform?.env?.GITHUB_TOKEN;

  if (!db) {
    throw error(500, 'Database not available');
  }

  if (!githubToken) {
    throw error(500, 'GitHub token not configured');
  }

  const body = await request.json() as { skillId: string };
  const { skillId } = body;

  if (!skillId) {
    throw error(400, 'Missing skillId');
  }

  try {
    // Get skill info
    const skill = await db.prepare(`
      SELECT id, repo_owner, repo_name, tier
      FROM skills
      WHERE id = ?
    `).bind(skillId).first<{
      id: string;
      repo_owner: string;
      repo_name: string;
      tier: string;
    }>();

    if (!skill) {
      throw error(404, 'Skill not found');
    }

    if (skill.tier !== 'archived') {
      return json({
        resurrected: false,
        reason: 'Skill is not archived',
        currentTier: skill.tier,
      });
    }

    // Fetch current GitHub data
    const githubData = await fetchGitHubRepoData(
      skill.repo_owner,
      skill.repo_name,
      githubToken
    );

    if (!githubData) {
      return json({
        resurrected: false,
        reason: 'Could not fetch GitHub data',
      });
    }

    // Check resurrection conditions
    const shouldResurrect =
      githubData.stargazerCount >= USER_ACCESS_STAR_THRESHOLD ||
      isRecentlyActive(githubData.pushedAt, RECENT_ACTIVITY_DAYS);

    if (!shouldResurrect) {
      return json({
        resurrected: false,
        reason: 'Does not meet resurrection criteria',
        stars: githubData.stargazerCount,
        lastPush: githubData.pushedAt,
      });
    }

    // Resurrect the skill
    const now = Date.now();
    await db.prepare(`
      UPDATE skills
      SET tier = 'cold',
          stars = ?,
          updated_at = ?,
          last_accessed_at = ?
      WHERE id = ?
    `)
      .bind(githubData.stargazerCount, now, now, skillId)
      .run();

    return json({
      resurrected: true,
      skillId,
      stars: githubData.stargazerCount,
      newTier: 'cold',
    });
  } catch (err) {
    console.error('Resurrection check error:', err);
    if (err instanceof Error && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to check resurrection');
  }
};
