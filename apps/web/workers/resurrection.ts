/**
 * Resurrection Worker
 *
 * Runs quarterly to check archived skills for resurrection:
 * - stars >= 50 (high threshold for batch check)
 * - 90 days recent activity
 *
 * Also provides /resurrect endpoint for on-demand resurrection
 * triggered by user access to archived skills.
 */

import type { BaseEnv, GitHubGraphQLRepoData, SkillTier, ExecutionContext, ScheduledController } from './shared/types';
import { githubFetch } from './shared/utils';

interface ResurrectionEnv extends BaseEnv {}

interface ArchivedSkill {
  id: string;
  repo_owner: string;
  repo_name: string;
}

interface ArchiveData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  repo_owner: string;
  repo_name: string;
  stars: number;
  forks: number;
  star_snapshots: string | null;
  trending_score: number;
  last_commit_at: number | null;
  last_accessed_at: number | null;
  created_at: number;
  indexed_at: number;
  categories: string[];
  skillMdContent: string | null;
  archivedAt: string;
}

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const BATCH_SIZE = 50;

// Resurrection thresholds
const QUARTERLY_STAR_THRESHOLD = 50;
const USER_ACCESS_STAR_THRESHOLD = 20;
const RECENT_ACTIVITY_DAYS = 90;

/**
 * Split array into chunks
 */
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
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

  if (!env.GITHUB_TOKEN || repos.length === 0) {
    return results;
  }

  const repoQueries = repos.map((repo, idx) => {
    const alias = `repo${idx}`;
    return `${alias}: repository(owner: "${repo.owner}", name: "${repo.name}") {
      stargazerCount
      forkCount
      pushedAt
      description
      repositoryTopics(first: 10) {
        nodes { topic { name } }
      }
    }`;
  }).join('\n');

  const query = `query { ${repoQueries} }`;

  try {
    const data = await githubFetch<{ data: Record<string, GitHubGraphQLRepoData | null> }>(
      GITHUB_GRAPHQL_URL,
      {
        token: env.GITHUB_TOKEN,
        userAgent: 'SkillsCat-Resurrection-Worker/1.0',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        notFoundAsNull: false,
      }
    );
    if (!data?.data) return results;

    repos.forEach((repo, idx) => {
      const repoData = data.data[`repo${idx}`];
      if (repoData) {
        results.set(repo.id, repoData);
      }
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
  skillId: string
): Promise<boolean> {
  try {
    // Find archive file
    const archiveList = await env.R2.list({ prefix: 'archive/' });
    let archivePath: string | null = null;

    for (const obj of archiveList.objects) {
      if (obj.key.includes(skillId)) {
        archivePath = obj.key;
        break;
      }
    }

    if (!archivePath) {
      console.log(`No archive found for skill ${skillId}`);
      return false;
    }

    // Get archive data
    const archiveObj = await env.R2.get(archivePath);
    if (!archiveObj) {
      console.error(`Archive file not found: ${archivePath}`);
      return false;
    }

    const archiveData = await archiveObj.json() as ArchiveData;

    // Restore SKILL.md to R2
    if (archiveData.skillMdContent) {
      const skillMdPath = `skills/${archiveData.repo_owner}/${archiveData.repo_name}/SKILL.md`;
      await env.R2.put(skillMdPath, archiveData.skillMdContent, {
        httpMetadata: { contentType: 'text/markdown' },
      });
    }

    // Update skill tier to cold (will be promoted based on activity)
    const now = Date.now();
    await env.DB.prepare(`
      UPDATE skills
      SET tier = 'cold',
          last_accessed_at = ?,
          updated_at = ?
      WHERE id = ?
    `)
      .bind(now, now, skillId)
      .run();

    // Restore categories
    for (const categorySlug of archiveData.categories) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
        VALUES (?, ?)
      `)
        .bind(skillId, categorySlug)
        .run();
    }

    // Delete archive file
    await env.R2.delete(archivePath);

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
  const success = await resurrectSkill(env, skillId);
  return {
    resurrected: success,
    reason: success ? 'resurrected' : 'resurrection_failed',
  };
}

/**
 * Record resurrection metrics to KV
 */
async function recordMetrics(
  env: ResurrectionEnv,
  stats: { checked: number; resurrected: number; failed: number; githubCalls: number }
): Promise<void> {
  const now = new Date();
  const quarterKey = `metrics:resurrection:${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;

  await env.KV.put(quarterKey, JSON.stringify({
    ...stats,
    timestamp: Date.now(),
  }), {
    expirationTtl: 365 * 24 * 60 * 60, // 1 year
  });
}

export default {
  /**
   * Quarterly scheduled check of all archived skills
   */
  async scheduled(
    _controller: ScheduledController,
    env: ResurrectionEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Resurrection Worker triggered at:', new Date().toISOString());

    // Get all archived skills
    const archived = await env.DB.prepare(`
      SELECT id, repo_owner, repo_name
      FROM skills
      WHERE tier = 'archived'
    `).all<ArchivedSkill>();

    console.log(`Found ${archived.results.length} archived skills to check`);

    if (archived.results.length === 0) {
      console.log('No archived skills to check');
      return;
    }

    let resurrected = 0;
    let failed = 0;
    let githubCalls = 0;

    // Process in batches
    const batches = chunks(archived.results, BATCH_SIZE);

    for (const batch of batches) {
      githubCalls++;

      const reposToFetch = batch.map(s => ({
        owner: s.repo_owner,
        name: s.repo_name,
        id: s.id,
      }));

      const githubData = await batchFetchGitHubRepos(reposToFetch, env);

      for (const skill of batch) {
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
          const success = await resurrectSkill(env, skill.id);
          if (success) {
            resurrected++;
            console.log(`Resurrected: ${skill.repo_owner}/${skill.repo_name} (stars: ${data.stargazerCount})`);
          } else {
            failed++;
          }
        }
      }

      // Rate limiting: wait between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`Resurrection complete: ${resurrected} resurrected, ${failed} failed`);

    // Record metrics
    await recordMetrics(env, {
      checked: archived.results.length,
      resurrected,
      failed,
      githubCalls,
    });

    console.log('Resurrection Worker completed');
  },
};

// Export types and functions for use in main web worker
export type { ResurrectionEnv };
export { checkAndResurrectSingle };
