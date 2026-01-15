/**
 * Trending Worker
 *
 * 定时计算 trending 分数
 * - 每小时运行一次
 * - 计算所有 skills 的 trending score
 * - 更新 D1 数据库
 * - 重新生成 R2 缓存
 */

import type {
  Env,
  StarSnapshot,
  SkillRecord,
  GitHubRepoData,
  SkillListItem,
} from './types';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * 计算 trending score
 */
export function calculateTrendingScore(skill: {
  stars: number;
  starSnapshots: StarSnapshot[];
  indexedAt: number;
  lastCommitAt: number | null;
}): number {
  const now = Date.now();

  // BaseScore: 基于 stars 的对数分数
  const baseScore = Math.log10(skill.stars + 1) * 10;

  // VelocityMultiplier: 增速乘数
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

  // RecencyBoost: 新鲜度加成
  const daysSinceIndexed = (now - skill.indexedAt) / 86400000;
  const recencyBoost = Math.max(1.0, 1.5 - daysSinceIndexed / 14);

  // ActivityPenalty: 活跃度惩罚
  let activityPenalty = 1.0;
  if (skill.lastCommitAt) {
    const daysSinceCommit = (now - skill.lastCommitAt) / 86400000;
    if (daysSinceCommit > 365) activityPenalty = 0.3;
    else if (daysSinceCommit > 180) activityPenalty = 0.5;
    else if (daysSinceCommit > 90) activityPenalty = 0.7;
    else if (daysSinceCommit > 30) activityPenalty = 0.9;
  }

  const score = baseScore * velocityMultiplier * recencyBoost * activityPenalty;
  return Math.round(score * 100) / 100;
}

/**
 * 获取 N 天前的 stars 数量
 */
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

/**
 * 压缩 star 快照 (保留最多 20 个点)
 */
function compressSnapshots(snapshots: StarSnapshot[]): StarSnapshot[] {
  if (snapshots.length <= 20) return snapshots;

  const result: StarSnapshot[] = [];
  const now = new Date();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const date = new Date(snap.d);
    const daysAgo = (now.getTime() - date.getTime()) / 86400000;

    // 保留规则
    const isFirst = i === 0;
    const isLast = i === snapshots.length - 1;
    const isRecent = daysAgo <= 7; // 最近 7 天
    const isWeekly = daysAgo <= 56 && date.getDay() === 0; // 8 周内的周日
    const isMonthly = daysAgo > 56 && date.getDate() === 1; // 更早的月初

    // 显著变化 (> 10%)
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
 * 获取 GitHub 仓库数据
 */
async function fetchGitHubRepo(
  owner: string,
  name: string,
  env: Env
): Promise<GitHubRepoData | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${name}`;

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SkillsCat-Trending-Worker/1.0',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    console.error(`GitHub API error for ${owner}/${name}: ${response.status}`);
    return null;
  }

  const data = await response.json() as {
    stargazers_count: number;
    forks_count: number;
    pushed_at: string;
  };

  return {
    stars: data.stargazers_count,
    forks: data.forks_count,
    pushedAt: new Date(data.pushed_at).getTime(),
  };
}

/**
 * 更新需要更新的 skills (从 KV 标记)
 */
async function updateMarkedSkills(env: Env): Promise<number> {
  // 获取需要更新的 skill IDs
  const list = await env.KV.list({ prefix: 'needs_update:', limit: 100 });

  if (list.keys.length === 0) {
    return 0;
  }

  const skillIds = list.keys.map((k) => k.name.replace('needs_update:', ''));

  // 从 D1 获取 skill 信息
  const placeholders = skillIds.map(() => '?').join(',');
  const skills = await env.DB.prepare(`
    SELECT id, repo_owner, repo_name, stars, star_snapshots, indexed_at, last_commit_at
    FROM skills WHERE id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<SkillRecord>();

  const updates: Array<{
    id: string;
    stars: number;
    forks: number;
    starSnapshots: string;
    lastCommitAt: number;
    score: number;
  }> = [];

  // 批量获取 GitHub 数据
  for (const skill of skills.results) {
    try {
      const ghData = await fetchGitHubRepo(skill.repo_owner, skill.repo_name, env);

      if (!ghData) continue;

      // 解析现有快照
      const snapshots: StarSnapshot[] = skill.star_snapshots
        ? JSON.parse(skill.star_snapshots)
        : [];

      // 添加新快照 (如果 stars 变化)
      if (ghData.stars !== skill.stars) {
        snapshots.push({
          d: new Date().toISOString().split('T')[0],
          s: ghData.stars,
        });
      }

      // 压缩快照
      const compressed = compressSnapshots(snapshots);

      // 计算 trending score
      const score = calculateTrendingScore({
        stars: ghData.stars,
        starSnapshots: compressed,
        indexedAt: skill.indexed_at,
        lastCommitAt: ghData.pushedAt,
      });

      updates.push({
        id: skill.id,
        stars: ghData.stars,
        forks: ghData.forks,
        starSnapshots: JSON.stringify(compressed),
        lastCommitAt: ghData.pushedAt,
        score,
      });
    } catch (error) {
      console.error(`Failed to update ${skill.id}:`, error);
    }
  }

  // 批量写入 D1
  if (updates.length > 0) {
    const now = Date.now();
    const statements = updates.map((u) =>
      env.DB.prepare(`
        UPDATE skills
        SET stars = ?, forks = ?, star_snapshots = ?, last_commit_at = ?, trending_score = ?, updated_at = ?
        WHERE id = ?
      `).bind(u.stars, u.forks, u.starSnapshots, u.lastCommitAt, u.score, now, u.id)
    );

    await env.DB.batch(statements);
  }

  // 清理 KV 标记
  await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));

  return updates.length;
}

/**
 * 更新所有 skills 的 trending score (不获取 GitHub 数据)
 */
async function recalculateAllScores(env: Env): Promise<number> {
  // 获取所有 skills
  const skills = await env.DB.prepare(`
    SELECT id, stars, star_snapshots, indexed_at, last_commit_at
    FROM skills
  `).all<SkillRecord>();

  const updates: Array<{ id: string; score: number }> = [];

  for (const skill of skills.results) {
    const snapshots: StarSnapshot[] = skill.star_snapshots
      ? JSON.parse(skill.star_snapshots)
      : [];

    const score = calculateTrendingScore({
      stars: skill.stars,
      starSnapshots: snapshots,
      indexedAt: skill.indexed_at,
      lastCommitAt: skill.last_commit_at,
    });

    // 只有分数变化才更新
    if (Math.abs(score - skill.trending_score) > 0.01) {
      updates.push({ id: skill.id, score });
    }
  }

  // 批量更新 (每批最多 100 条)
  const now = Date.now();
  for (let i = 0; i < updates.length; i += 100) {
    const batch = updates.slice(i, i + 100);
    const statements = batch.map((u) =>
      env.DB.prepare(`
        UPDATE skills SET trending_score = ?, updated_at = ? WHERE id = ?
      `).bind(u.score, now, u.id)
    );
    await env.DB.batch(statements);
  }

  return updates.length;
}

/**
 * 重新生成缓存列表
 */
async function regenerateListCaches(env: Env): Promise<void> {
  const now = Date.now();

  // Trending 列表
  const trending = await env.DB.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner, s.repo_name,
           s.stars, s.forks, s.trending_score, s.updated_at,
           a.avatar_url as author_avatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    ORDER BY s.trending_score DESC
    LIMIT 100
  `).all<SkillListItem>();

  await env.R2.put(
    'cache/trending.json',
    JSON.stringify({ data: trending.results, generatedAt: now }),
    { httpMetadata: { contentType: 'application/json' } }
  );

  // Top 列表 (by stars)
  const top = await env.DB.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner, s.repo_name,
           s.stars, s.forks, s.trending_score, s.updated_at,
           a.avatar_url as author_avatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
    ORDER BY s.stars DESC
    LIMIT 100
  `).all<SkillListItem>();

  await env.R2.put(
    'cache/top.json',
    JSON.stringify({ data: top.results, generatedAt: now }),
    { httpMetadata: { contentType: 'application/json' } }
  );

  // Recent 列表
  const recent = await env.DB.prepare(`
    SELECT s.id, s.name, s.slug, s.description, s.repo_owner, s.repo_name,
           s.stars, s.forks, s.trending_score, s.updated_at,
           a.avatar_url as author_avatar
    FROM skills s
    LEFT JOIN authors a ON s.author_id = a.id
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

export default {
  /**
   * Cron Trigger Handler
   * 每小时执行一次
   */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('Trending Worker triggered at:', new Date().toISOString());

    // 1. 更新标记的 skills (从 KV)
    const markedUpdates = await updateMarkedSkills(env);
    console.log(`Updated ${markedUpdates} marked skills`);

    // 2. 重新计算所有 trending scores
    const scoreUpdates = await recalculateAllScores(env);
    console.log(`Recalculated ${scoreUpdates} trending scores`);

    // 3. 重新生成缓存
    await regenerateListCaches(env);

    console.log('Trending update completed');
  },

  /**
   * HTTP Handler (用于健康检查和手动触发)
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
