/**
 * Resurrection Worker
 *
 * Runs quarterly to check archived skills for resurrection:
 * - stars >= 50 (high threshold for batch check)
 * - 90 days recent activity
 *
 * Also provides /check endpoint for on-demand resurrection
 * triggered by user access to archived skills.
 */

import type { BaseEnv, GitHubGraphQLRepoData, SkillTier, ExecutionContext, ScheduledController } from './shared/types';
import {
  estimateGraphqlBatchRepoMetadataCalls,
  graphqlBatchRepoMetadata,
} from '../src/lib/server/github-client/queries';
import { getGitHubRequestAuthFromEnv, hasGitHubAuthConfigured } from '../src/lib/server/github-client/env';
import { restoreArchivedSkillFromR2 } from '../src/lib/server/skill/resurrection';

interface ResurrectionEnv extends BaseEnv {}

interface ArchivedSkill {
  id: string;
  updated_at: number;
  repo_owner: string;
  repo_name: string;
}

// Resurrection thresholds
const QUARTERLY_STAR_THRESHOLD = 50;
const USER_ACCESS_STAR_THRESHOLD = 20;
const RECENT_ACTIVITY_DAYS = 90;
const RESURRECTION_BATCH_SIZE = 200;
const RESURRECTION_CURSOR_KEY = 'resurrection:cursor';

interface ResurrectionCursor {
  updatedAt: number;
  id: string;
}

/**
 * Check if a date is within recent activity window
 */
function isRecentlyActive(pushedAt: string | null, days: number): boolean {
  if (!pushedAt) return false;
  const pushedDate = new Date(pushedAt).getTime();
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  return pushedDate > threshold;
}

/**
 * Batch fetch GitHub repo data using GraphQL API
 */
async function batchFetchGitHubRepos(
  repos: Array<{ owner: string; name: string; id: string }>,
  env: ResurrectionEnv
): Promise<Map<string, GitHubGraphQLRepoData>> {
  const results = new Map<string, GitHubGraphQLRepoData>();

  if (!hasGitHubAuthConfigured(env) || repos.length === 0) {
    return results;
  }

  try {
    const batch = await graphqlBatchRepoMetadata(repos, {
      ...getGitHubRequestAuthFromEnv(env),
      userAgent: 'SkillsCat-Resurrection-Worker/1.0',
      includeExtendedMetadata: false,
      continueOnChunkError: true,
    });
    batch.forEach((value, key) => {
      results.set(key, value as GitHubGraphQLRepoData);
    });
  } catch (error) {
    console.error('GitHub GraphQL batch fetch failed:', error);
  }

  return results;
}

/**
 * Resurrect a skill from archive
 */
async function resurrectSkill(
  env: ResurrectionEnv,
  skillId: string,
  stars?: number | null
): Promise<boolean> {
  try {
    const restored = await restoreArchivedSkillFromR2({
      db: env.DB,
      r2: env.R2,
      skillId,
      stars: stars ?? null,
    });

    if (!restored) {
      console.log(`No archive found for skill ${skillId}`);
      return false;
    }

    console.log(`Resurrected skill: ${skillId}`);
    return true;
  } catch (error) {
    console.error(`Failed to resurrect skill ${skillId}:`, error);
    return false;
  }
}

/**
 * Check a single skill for resurrection eligibility
 */
async function checkAndResurrectSingle(
  env: ResurrectionEnv,
  skillId: string,
  starThreshold: number
): Promise<{ resurrected: boolean; reason?: string }> {
  // Get skill info
  const skill = await env.DB.prepare(`
    SELECT repo_owner, repo_name, tier FROM skills WHERE id = ?
  `)
    .bind(skillId)
    .first<{ repo_owner: string; repo_name: string; tier: SkillTier }>();

  if (!skill) {
    return { resurrected: false, reason: 'skill_not_found' };
  }

  if (skill.tier !== 'archived') {
    return { resurrected: false, reason: 'not_archived' };
  }

  // Fetch current GitHub status
  const githubData = await batchFetchGitHubRepos(
    [{ owner: skill.repo_owner, name: skill.repo_name, id: skillId }],
    env
  );

  const data = githubData.get(skillId);
  if (!data) {
    return { resurrected: false, reason: 'github_fetch_failed' };
  }

  // Check resurrection conditions
  const shouldResurrect =
    data.stargazerCount >= starThreshold ||
    isRecentlyActive(data.pushedAt, RECENT_ACTIVITY_DAYS);

  if (!shouldResurrect) {
    return {
      resurrected: false,
      reason: `below_threshold (stars: ${data.stargazerCount}, threshold: ${starThreshold})`,
    };
  }

  // Resurrect the skill
  const success = await resurrectSkill(env, skillId, data.stargazerCount);
  return {
    resurrected: success,
    reason: success ? 'resurrected' : 'resurrection_failed',
  };
}

function recordMetrics(
  env: ResurrectionEnv,
  stats: { checked: number; resurrected: number; failed: number; githubCalls: number; durationMs: number }
): void {
  if (!env.WORKER_ANALYTICS) {
    return;
  }

  try {
    env.WORKER_ANALYTICS.writeDataPoint({
      blobs: ['scheduled'],
      doubles: [
        stats.checked,
        stats.resurrected,
        stats.failed,
        stats.githubCalls,
        stats.durationMs,
      ],
      indexes: ['resurrection-run'],
    });
  } catch (error) {
    console.error('Failed to write resurrection analytics datapoint:', error);
  }
}

export default {
  async fetch(request: Request, env: ResurrectionEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/check') {
      const authHeader = request.headers.get('Authorization');
      if (!env.WORKER_SECRET || authHeader !== `Bearer ${env.WORKER_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
      }

      let body: { skillId?: string } = {};
      try {
        body = await request.json() as { skillId?: string };
      } catch {
        return Response.json({ resurrected: false, reason: 'invalid_json' }, { status: 400 });
      }

      if (!body.skillId) {
        return Response.json({ resurrected: false, reason: 'missing_skill_id' }, { status: 400 });
      }

      const result = await checkAndResurrectSingle(env, body.skillId, USER_ACCESS_STAR_THRESHOLD);
      return Response.json(result);
    }

    return new Response('Not Found', { status: 404 });
  },

  /**
   * Quarterly scheduled check of all archived skills
   */
  async scheduled(
    _controller: ScheduledController,
    env: ResurrectionEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    const startedAt = Date.now();
    console.log('Resurrection Worker triggered at:', new Date().toISOString());

    // Process a bounded keyset page so a large archive never becomes one
    // unbounded Worker invocation.
    const rawCursor = await env.KV.get(RESURRECTION_CURSOR_KEY);
    let cursor: ResurrectionCursor | null = null;
    if (rawCursor) {
      try {
        const parsed = JSON.parse(rawCursor) as Partial<ResurrectionCursor>;
        if (Number.isFinite(parsed.updatedAt) && typeof parsed.id === 'string' && parsed.id) {
          cursor = { updatedAt: Number(parsed.updatedAt), id: parsed.id };
        }
      } catch {
        // Discard legacy id-only cursors; restarting avoids skipping rows.
      }
    }

    const archived = cursor
      ? await env.DB.prepare(`
          SELECT id, updated_at, repo_owner, repo_name
          FROM skills
          WHERE tier = 'archived'
            AND (updated_at > ? OR (updated_at = ? AND id > ?))
          ORDER BY updated_at, id
          LIMIT ?
        `).bind(cursor.updatedAt, cursor.updatedAt, cursor.id, RESURRECTION_BATCH_SIZE).all<ArchivedSkill>()
      : await env.DB.prepare(`
          SELECT id, updated_at, repo_owner, repo_name
          FROM skills
          WHERE tier = 'archived'
          ORDER BY updated_at, id
          LIMIT ?
        `).bind(RESURRECTION_BATCH_SIZE).all<ArchivedSkill>();

    console.log(`Found ${archived.results.length} archived skills to check`);

    if (archived.results.length === 0) {
      await env.KV.delete(RESURRECTION_CURSOR_KEY);
      console.log('No archived skills to check');
      return;
    }

    let resurrected = 0;
    let failed = 0;
    let githubCalls = 0;

    const reposToFetch = archived.results.map(s => ({
      owner: s.repo_owner,
      name: s.repo_name,
      id: s.id,
    }));

    githubCalls = hasGitHubAuthConfigured(env)
      ? estimateGraphqlBatchRepoMetadataCalls(reposToFetch)
      : 0;

    const githubData = await batchFetchGitHubRepos(reposToFetch, env);

    for (const skill of archived.results) {
      const data = githubData.get(skill.id);
      if (!data) {
        failed++;
        continue;
      }

      // Check resurrection conditions (high threshold for batch)
      const shouldResurrect =
        data.stargazerCount >= QUARTERLY_STAR_THRESHOLD ||
        isRecentlyActive(data.pushedAt, RECENT_ACTIVITY_DAYS);

      if (shouldResurrect) {
        const success = await resurrectSkill(env, skill.id, data.stargazerCount);
        if (success) {
          resurrected++;
          console.log(`Resurrected: ${skill.repo_owner}/${skill.repo_name} (stars: ${data.stargazerCount})`);
        } else {
          failed++;
        }
      }
    }

    const lastRow = archived.results.at(-1);
    if (lastRow && archived.results.length >= RESURRECTION_BATCH_SIZE) {
      await env.KV.put(
        RESURRECTION_CURSOR_KEY,
        JSON.stringify({ updatedAt: lastRow.updated_at, id: lastRow.id } satisfies ResurrectionCursor),
        { expirationTtl: 366 * 86400 }
      );
    } else {
      await env.KV.delete(RESURRECTION_CURSOR_KEY);
    }

    console.log(`Resurrection complete: ${resurrected} resurrected, ${failed} failed`);

    // Record metrics
    await recordMetrics(env, {
      checked: archived.results.length,
      resurrected,
      failed,
      githubCalls,
      durationMs: Date.now() - startedAt,
    });

    console.log('Resurrection Worker completed');
  },
};

// Export types and functions for use in main web worker
export type { ResurrectionEnv };
export { checkAndResurrectSingle };
