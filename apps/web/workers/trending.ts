/**
 * Trending Worker
 *
 * Cost-optimized trending score calculation with tiered updates:
 * - Hot tier (stars>=1000 or 7d access): every 6 hours
 * - Warm tier (stars>=100 or 30d access): every 24 hours
 * - Cool tier (stars>=10 or 90d access): every 7 days
 * - Cold tier: only on user access
 * - Archived: never updated
 *
 * Uses GitHub GraphQL API for batch queries (50 repos per request)
 */

import type {
  TrendingEnv,
  StarSnapshot,
  SkillRecord,
  SkillListItem,
  SkillTier,
  GitHubGraphQLRepoData,
  ClassificationMessage,
} from './shared/types';
import { TIER_CONFIG } from './shared/types';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
const BATCH_SIZE = 50; // GitHub GraphQL limit
const MAX_SKILLS_PER_RUN = 500; // Limit per cron run to control costs
const AI_CLASSIFICATION_THRESHOLD = 100; // Stars threshold for AI classification

export function calculateTrendingScore(skill: {
  stars: number;
  starSnapshots: StarSnapshot[];
  indexedAt: number;
  lastCommitAt: number | null;
  downloadCount7d?: number;
}): number {
  const now = Date.now();

  const baseScore = Math.log10(skill.stars + 1) * 10;

  const stars7dAgo = getStarsAtDaysAgo(skill.starSnapshots, 7, skill.stars);
  const stars30dAgo = getStarsAtDaysAgo(skill.starSnapshots, 30, skill.stars);

  const dailyGrowth7d = Math.max(0, (skill.stars - stars7dAgo) / 7);
  const dailyGrowth30d = Math.max(0, (skill.stars - stars30dAgo) / 30);

  const acceleration =
    dailyGrowth30d > 0.1
      ? dailyGrowth7d / dailyGrowth30d
      : dailyGrowth7d > 0
        ? 2
        : 1;

  const velocityMultiplier = Math.min(
    5.0,
    Math.max(1.0, 1.0 + Math.log2(dailyGrowth7d + 1) * Math.min(acceleration, 3) * 0.4)
  );

  const daysSinceIndexed = (now - skill.indexedAt) / 86400000;
  const recencyBoost = Math.max(1.0, 1.5 - daysSinceIndexed / 14);

  let activityPenalty = 1.0;
  if (skill.lastCommitAt) {
    const daysSinceCommit = (now - skill.lastCommitAt) / 86400000;
    if (daysSinceCommit > 365) activityPenalty = 0.3;
    else if (daysSinceCommit > 180) activityPenalty = 0.5;
    else if (daysSinceCommit > 90) activityPenalty = 0.7;
    else if (daysSinceCommit > 30) activityPenalty = 0.9;
  }

  // Download boost: 0 downloads → 1.0x, 10 → ~1.52x, 100 → 2.0x (capped)
  const downloads7d = skill.downloadCount7d ?? 0;
  const downloadBoost = Math.min(2.0, 1.0 + Math.log2(downloads7d + 1) * 0.15);

  const score = baseScore * velocityMultiplier * recencyBoost * activityPenalty * downloadBoost;
  return Math.round(score * 100) / 100;
}

function getStarsAtDaysAgo(
  snapshots: StarSnapshot[],
  daysAgo: number,
  currentStars: number
): number {
  if (!snapshots || snapshots.length === 0) return currentStars;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAgo);
  const target = targetDate.toISOString().split('T')[0];

  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].d <= target) {
      return snapshots[i].s;
    }
  }

  return snapshots[0]?.s ?? currentStars;
}

function compressSnapshots(snapshots: StarSnapshot[]): StarSnapshot[] {
  if (snapshots.length <= 20) return snapshots;

  const result: StarSnapshot[] = [];
  const now = new Date();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const date = new Date(snap.d);
    const daysAgo = (now.getTime() - date.getTime()) / 86400000;

    const isFirst = i === 0;
    const isLast = i === snapshots.length - 1;
    const isRecent = daysAgo <= 7;
    const isWeekly = daysAgo <= 56 && date.getDay() === 0;
    const isMonthly = daysAgo > 56 && date.getDate() === 1;

    const prev = snapshots[i - 1];
    const isSignificant =
      prev && prev.s > 0 && Math.abs(snap.s - prev.s) / prev.s > 0.1;

    if (isFirst || isLast || isRecent || isWeekly || isMonthly || isSignificant) {
      result.push(snap);
    }
  }

  return result.slice(-20);
}

/**
 * Batch fetch GitHub repo data using GraphQL API
 * Reduces API calls by 98% (50 repos per request vs 1)
 */
async function batchFetchGitHubRepos(
  repos: Array<{ owner: string; name: string; id: string }>,
  env: TrendingEnv
): Promise<Map<string, GitHubGraphQLRepoData>> {
  const results = new Map<string, GitHubGraphQLRepoData>();

  if (!env.GITHUB_TOKEN || repos.length === 0) {
    return results;
  }

  // Build GraphQL query for batch of repos
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
    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'User-Agent': 'SkillsCat-Trending-Worker/2.0',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      console.error(`GitHub GraphQL error: ${response.status}`);
      return results;
    }

    const data = await response.json() as { data: Record<string, GitHubGraphQLRepoData | null> };

    repos.forEach((repo, idx) => {
      const repoData = data.data?.[`repo${idx}`];
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
 * Calculate the appropriate tier for a skill based on stars and access patterns
 */
export function calculateTier(skill: {
  stars: number;
  lastAccessedAt: number | null;
  accessCount7d: number;
}): SkillTier {
  const now = Date.now();
  const lastAccess = skill.lastAccessedAt || 0;

  // Hot: stars >= 1000 OR accessed in last 7 days
  if (skill.stars >= TIER_CONFIG.hot.minStars ||
      (now - lastAccess) < TIER_CONFIG.hot.accessWindow) {
    return 'hot';
  }

  // Warm: stars >= 100 OR accessed in last 30 days
  if (skill.stars >= TIER_CONFIG.warm.minStars ||
      (now - lastAccess) < TIER_CONFIG.warm.accessWindow) {
    return 'warm';
  }

  // Cool: stars >= 10 OR accessed in last 90 days
  if (skill.stars >= TIER_CONFIG.cool.minStars ||
      (now - lastAccess) < TIER_CONFIG.cool.accessWindow) {
    return 'cool';
  }

  // Cold: everything else
  return 'cold';
}

/**
 * Get next update time based on tier
 */
function getNextUpdateTime(tier: SkillTier): number | null {
  const interval = TIER_CONFIG[tier].updateInterval;
  if (interval === 0) return null;
  return Date.now() + interval;
}

/**
 * Update skills marked for update via KV (user-driven updates)
 */
async function updateMarkedSkills(env: TrendingEnv): Promise<number> {
  const list = await env.KV.list({ prefix: 'needs_update:', limit: 100 });

  if (list.keys.length === 0) {
    return 0;
  }

  const skillIds = list.keys.map((k) => k.name.replace('needs_update:', ''));

  const placeholders = skillIds.map(() => '?').join(',');
  const skills = await env.DB.prepare(`
    SELECT id, repo_owner, repo_name, stars, star_snapshots, indexed_at, last_commit_at,
           tier, last_accessed_at, access_count_7d, download_count_7d
    FROM skills WHERE id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<SkillRecord>();

  // Batch fetch from GitHub
  const reposToFetch = skills.results.map(s => ({
    owner: s.repo_owner,
    name: s.repo_name,
    id: s.id,
  }));

  const githubData = await batchFetchGitHubRepos(reposToFetch, env);

  const updates: Array<{
    id: string;
    stars: number;
    forks: number;
    starSnapshots: string;
    lastCommitAt: number;
    score: number;
    tier: SkillTier;
    nextUpdateAt: number | null;
  }> = [];

  for (const skill of skills.results) {
    const ghData = githubData.get(skill.id);
    if (!ghData) continue;

    const snapshots: StarSnapshot[] = skill.star_snapshots
      ? JSON.parse(skill.star_snapshots)
      : [];

    const newStars = ghData.stargazerCount;
    if (newStars !== skill.stars) {
      snapshots.push({
        d: new Date().toISOString().split('T')[0],
        s: newStars,
      });
    }

    const compressed = compressSnapshots(snapshots);
    const pushedAt = new Date(ghData.pushedAt).getTime();

    const score = calculateTrendingScore({
      stars: newStars,
      starSnapshots: compressed,
      indexedAt: skill.indexed_at,
      lastCommitAt: pushedAt,
      downloadCount7d: skill.download_count_7d,
    });

    const newTier = calculateTier({
      stars: newStars,
      lastAccessedAt: skill.last_accessed_at,
      accessCount7d: skill.access_count_7d,
    });

    updates.push({
      id: skill.id,
      stars: newStars,
      forks: ghData.forkCount,
      starSnapshots: JSON.stringify(compressed),
      lastCommitAt: pushedAt,
      score,
      tier: newTier,
      nextUpdateAt: getNextUpdateTime(newTier),
    });
  }

  if (updates.length > 0) {
    const now = Date.now();
    const statements = updates.map((u) =>
      env.DB.prepare(`
        UPDATE skills
        SET stars = ?, forks = ?, star_snapshots = ?, last_commit_at = ?,
            trending_score = ?, tier = ?, next_update_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(u.stars, u.forks, u.starSnapshots, u.lastCommitAt, u.score, u.tier, u.nextUpdateAt, now, u.id)
    );

    await env.DB.batch(statements);
  }

  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));

  return updates.length;
}

/**
 * Update skills by tier - only processes skills where next_update_at < now
 * This replaces the old recalculateAllScores() which read ALL skills
 * Returns both count and list of updated skill IDs for reclassification detection
 */
async function updateSkillsByTier(
  env: TrendingEnv,
  tiers: SkillTier[],
  limit: number
): Promise<{ count: number; updatedIds: string[] }> {
  const now = Date.now();
  const tierPlaceholders = tiers.map(() => '?').join(',');

  // Only fetch skills that are due for update
  const skills = await env.DB.prepare(`
    SELECT id, repo_owner, repo_name, stars, star_snapshots, indexed_at, last_commit_at,
           tier, last_accessed_at, access_count_7d, download_count_7d
    FROM skills
    WHERE tier IN (${tierPlaceholders})
      AND (next_update_at IS NULL OR next_update_at < ?)
      AND visibility = 'public'
    ORDER BY next_update_at ASC
    LIMIT ?
  `)
    .bind(...tiers, now, limit)
    .all<SkillRecord>();

  if (skills.results.length === 0) {
    return { count: 0, updatedIds: [] };
  }

  console.log(`Processing ${skills.results.length} skills from tiers: ${tiers.join(', ')}`);

  // Process in batches of BATCH_SIZE for GraphQL
  let totalUpdated = 0;
  const allUpdatedIds: string[] = [];

  for (let i = 0; i < skills.results.length; i += BATCH_SIZE) {
    const batch = skills.results.slice(i, i + BATCH_SIZE);
    const reposToFetch = batch.map(s => ({
      owner: s.repo_owner,
      name: s.repo_name,
      id: s.id,
    }));

    const githubData = await batchFetchGitHubRepos(reposToFetch, env);

    const updates: Array<{
      id: string;
      stars: number;
      forks: number;
      starSnapshots: string;
      lastCommitAt: number;
      score: number;
      tier: SkillTier;
      nextUpdateAt: number | null;
    }> = [];

    for (const skill of batch) {
      const ghData = githubData.get(skill.id);

      // If GitHub fetch failed, just recalculate score with existing data
      const newStars = ghData?.stargazerCount ?? skill.stars;
      const newForks = ghData?.forkCount ?? skill.forks;
      const pushedAt = ghData ? new Date(ghData.pushedAt).getTime() : skill.last_commit_at;

      const snapshots: StarSnapshot[] = skill.star_snapshots
        ? JSON.parse(skill.star_snapshots)
        : [];

      if (ghData && newStars !== skill.stars) {
        snapshots.push({
          d: new Date().toISOString().split('T')[0],
          s: newStars,
        });
      }

      const compressed = compressSnapshots(snapshots);

      const score = calculateTrendingScore({
        stars: newStars,
        starSnapshots: compressed,
        indexedAt: skill.indexed_at,
        lastCommitAt: pushedAt,
        downloadCount7d: skill.download_count_7d,
      });

      const newTier = calculateTier({
        stars: newStars,
        lastAccessedAt: skill.last_accessed_at,
        accessCount7d: skill.access_count_7d,
      });

      updates.push({
        id: skill.id,
        stars: newStars,
        forks: newForks,
        starSnapshots: JSON.stringify(compressed),
        lastCommitAt: pushedAt || 0,
        score,
        tier: newTier,
        nextUpdateAt: getNextUpdateTime(newTier),
      });
    }

    if (updates.length > 0) {
      const statements = updates.map((u) =>
        env.DB.prepare(`
          UPDATE skills
          SET stars = ?, forks = ?, star_snapshots = ?, last_commit_at = ?,
              trending_score = ?, tier = ?, next_update_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(u.stars, u.forks, u.starSnapshots, u.lastCommitAt, u.score, u.tier, u.nextUpdateAt, now, u.id)
      );

      await env.DB.batch(statements);
      totalUpdated += updates.length;
      allUpdatedIds.push(...updates.map(u => u.id));
    }
  }

  return { count: totalUpdated, updatedIds: allUpdatedIds };
}

/**
 * Detect skills that need AI reclassification
 * Triggers when:
 * - Stars grew from < 100 to >= 100
 * - Current classification_method is 'keyword' (not 'ai' or 'direct')
 */
async function detectReclassificationNeeded(
  env: TrendingEnv,
  updatedSkillIds: string[]
): Promise<number> {
  if (!env.CLASSIFICATION_QUEUE || updatedSkillIds.length === 0) {
    return 0;
  }

  // Find skills that crossed the AI threshold and need reclassification
  const placeholders = updatedSkillIds.map(() => '?').join(',');
  const skills = await env.DB.prepare(`
    SELECT id, repo_owner, repo_name, skill_path, stars, classification_method
    FROM skills
    WHERE id IN (${placeholders})
      AND stars >= ?
      AND classification_method = 'keyword'
  `)
    .bind(...updatedSkillIds, AI_CLASSIFICATION_THRESHOLD)
    .all<{
      id: string;
      repo_owner: string;
      repo_name: string;
      skill_path: string | null;
      stars: number;
      classification_method: string;
    }>();

  if (skills.results.length === 0) {
    return 0;
  }

  console.log(`Found ${skills.results.length} skills needing AI reclassification`);

  // Queue reclassification messages
  for (const skill of skills.results) {
    const skillMdPath = skill.skill_path
      ? `skills/${skill.repo_owner}/${skill.repo_name}/${skill.skill_path}/SKILL.md`
      : `skills/${skill.repo_owner}/${skill.repo_name}/SKILL.md`;

    const message: ClassificationMessage & { stars: number; isReclassification: boolean } = {
      type: 'classify',
      skillId: skill.id,
      repoOwner: skill.repo_owner,
      repoName: skill.repo_name,
      skillMdPath,
      stars: skill.stars,
      isReclassification: true,
    };

    await env.CLASSIFICATION_QUEUE.send(message);
    console.log(`Queued reclassification for ${skill.id} (stars: ${skill.stars})`);
  }

  return skills.results.length;
}

/**
 * Flush download/install counts from user_actions to skills rolling counters.
 *
 * This avoids per-request KV read/write amplification by writing events directly
 * to D1 (`user_actions`) and running one daily aggregation job.
 */
async function flushDownloadCounts(env: TrendingEnv): Promise<number> {
  try {
    // Guard: only flush once per day
    const lastFlush = await env.KV.get('dl:last_flush_actions');
    const today = new Date().toISOString().slice(0, 10);
    if (lastFlush === today) return 0;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 86400000;
    const thirtyDaysAgo = now - 30 * 86400000;
    const cleanupBefore = now - 35 * 86400000;

    // Keep event table bounded so daily aggregation stays cheap.
    await env.DB.prepare(`
      DELETE FROM user_actions
      WHERE action_type IN ('download', 'install')
        AND created_at < ?
    `)
      .bind(cleanupBefore)
      .run();

    const aggregated = await env.DB.prepare(`
      SELECT
        skill_id as skillId,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as sum7d,
        COUNT(*) as sum30d
      FROM user_actions
      WHERE action_type IN ('download', 'install')
        AND skill_id IS NOT NULL
        AND created_at >= ?
      GROUP BY skill_id
    `)
      .bind(sevenDaysAgo, thirtyDaysAgo)
      .all<{ skillId: string; sum7d: number; sum30d: number }>();

    if ((aggregated.results || []).length === 0) {
      await env.DB.prepare(`
        UPDATE skills
        SET download_count_7d = 0, download_count_30d = 0
        WHERE download_count_7d != 0 OR download_count_30d != 0
      `).run();
      await env.KV.put('dl:last_flush_actions', today, { expirationTtl: 86400 });
      return 0;
    }

    const entries = aggregated.results || [];
    const BATCH_SIZE = 100;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map((entry) =>
        env.DB.prepare(`
          UPDATE skills
          SET download_count_7d = ?, download_count_30d = ?
          WHERE id = ?
        `).bind(Number(entry.sum7d || 0), Number(entry.sum30d || 0), entry.skillId)
      );
      await env.DB.batch(stmts);
    }

    // Clear stale counters for skills with no download/install events in 30 days.
    await env.DB.prepare(`
      UPDATE skills
      SET download_count_7d = 0, download_count_30d = 0
      WHERE (download_count_7d != 0 OR download_count_30d != 0)
        AND id NOT IN (
          SELECT DISTINCT skill_id
          FROM user_actions
          WHERE action_type IN ('download', 'install')
            AND skill_id IS NOT NULL
            AND created_at >= ?
        )
    `)
      .bind(thirtyDaysAgo)
      .run();

    await env.KV.put('dl:last_flush_actions', today, { expirationTtl: 86400 });
    return entries.length;
  } catch (err) {
    console.error('Failed to flush download counts:', err);
    return 0;
  }
}

async function regenerateListCaches(env: TrendingEnv): Promise<void> {
  const now = Date.now();

  const trending = await env.DB.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner, s.repo_name,
           s.stars, s.forks, s.trending_score, s.updated_at,
           a.avatar_url as author_avatar
    FROM skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY s.trending_score DESC
    LIMIT 100
  `).all<SkillListItem>();

  await env.R2.put(
    'cache/trending.json',
    JSON.stringify({ data: trending.results, generatedAt: now }),
    { httpMetadata: { contentType: 'application/json' } }
  );

  const top = await env.DB.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner, s.repo_name,
           s.stars, s.forks, s.trending_score, s.updated_at,
           a.avatar_url as author_avatar
    FROM skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
      AND (s.skill_path IS NULL OR s.skill_path = '' OR s.skill_path NOT LIKE '.%')
    ORDER BY s.stars DESC
    LIMIT 100
  `).all<SkillListItem>();

  await env.R2.put(
    'cache/top.json',
    JSON.stringify({ data: top.results, generatedAt: now }),
    { httpMetadata: { contentType: 'application/json' } }
  );

  const recent = await env.DB.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner, s.repo_name,
           s.stars, s.forks, s.trending_score, s.updated_at,
           a.avatar_url as author_avatar
    FROM skills s
    LEFT JOIN authors a ON s.repo_owner = a.username
    WHERE s.visibility = 'public'
    ORDER BY s.indexed_at DESC
    LIMIT 100
  `).all<SkillListItem>();

  await env.R2.put(
    'cache/recent.json',
    JSON.stringify({ data: recent.results, generatedAt: now }),
    { httpMetadata: { contentType: 'application/json' } }
  );

  console.log('Cache lists regenerated');
}

/**
 * Record cost metrics to KV for monitoring
 */
async function recordMetrics(
  env: TrendingEnv,
  metrics: {
    markedUpdates: number;
    hotUpdates: number;
    warmUpdates: number;
    coolUpdates: number;
    githubApiCalls: number;
  }
): Promise<void> {
  const now = Date.now();
  const hourKey = `metrics:trending:${new Date().toISOString().slice(0, 13)}`;

  const existing = await env.KV.get(hourKey, 'json') as Record<string, number> | null;
  const updated = {
    markedUpdates: (existing?.markedUpdates || 0) + metrics.markedUpdates,
    hotUpdates: (existing?.hotUpdates || 0) + metrics.hotUpdates,
    warmUpdates: (existing?.warmUpdates || 0) + metrics.warmUpdates,
    coolUpdates: (existing?.coolUpdates || 0) + metrics.coolUpdates,
    githubApiCalls: (existing?.githubApiCalls || 0) + metrics.githubApiCalls,
    lastRun: now,
  };

  await env.KV.put(hourKey, JSON.stringify(updated), {
    expirationTtl: 7 * 24 * 60 * 60, // 7 days
  });
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: TrendingEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('Trending Worker triggered at:', new Date().toISOString());

    // Collect all updated skill IDs for reclassification detection
    const allUpdatedIds: string[] = [];

    // 1. Process user-marked skills first (highest priority)
    const markedUpdates = await updateMarkedSkills(env);
    console.log(`Updated ${markedUpdates} marked skills`);

    // 2. Update hot tier skills (every 6 hours, but check every hour)
    const hotResult = await updateSkillsByTier(env, ['hot'], MAX_SKILLS_PER_RUN);
    console.log(`Updated ${hotResult.count} hot tier skills`);
    allUpdatedIds.push(...hotResult.updatedIds);

    // 3. Update warm tier skills (every 24 hours)
    const warmResult = await updateSkillsByTier(env, ['warm'], MAX_SKILLS_PER_RUN);
    console.log(`Updated ${warmResult.count} warm tier skills`);
    allUpdatedIds.push(...warmResult.updatedIds);

    // 4. Update cool tier skills (every 7 days, but process some each hour)
    const coolResult = await updateSkillsByTier(env, ['cool'], Math.floor(MAX_SKILLS_PER_RUN / 4));
    console.log(`Updated ${coolResult.count} cool tier skills`);
    allUpdatedIds.push(...coolResult.updatedIds);

    // 5. Detect skills needing AI reclassification (stars crossed threshold)
    const reclassifications = await detectReclassificationNeeded(env, allUpdatedIds);
    if (reclassifications > 0) {
      console.log(`Queued ${reclassifications} skills for AI reclassification`);
    }

    // 6. Flush download/install rolling counts from user_actions to skills
    const downloadsFlushed = await flushDownloadCounts(env);
    if (downloadsFlushed > 0) {
      console.log(`Flushed download counts for ${downloadsFlushed} skills`);
    }

    // 7. Regenerate list caches
    await regenerateListCaches(env);

    // 8. Record metrics
    const totalBatches = Math.ceil((markedUpdates + hotResult.count + warmResult.count + coolResult.count) / BATCH_SIZE);
    await recordMetrics(env, {
      markedUpdates,
      hotUpdates: hotResult.count,
      warmUpdates: warmResult.count,
      coolUpdates: coolResult.count,
      githubApiCalls: totalBatches,
    });

    console.log('Trending update completed');
  },
};
