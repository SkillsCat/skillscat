/**
 * Tier Recalculation Worker
 *
 * Runs daily to recalculate skill tiers based on:
 * - Star count
 * - Access patterns (7d, 30d, 90d windows)
 *
 * Also resets access counters for expired windows
 */

import type { BaseEnv, SkillTier } from './shared/types';
import { TIER_CONFIG } from './shared/types';

interface TierRecalcEnv extends BaseEnv {}

interface SkillForTierCalc {
  id: string;
  stars: number;
  tier: SkillTier;
  last_accessed_at: number | null;
  access_count_7d: number;
  access_count_30d: number;
  last_commit_at: number | null;
}

/**
 * Calculate the appropriate tier for a skill
 */
function calculateTier(skill: SkillForTierCalc): SkillTier {
  const now = Date.now();
  const lastAccess = skill.last_accessed_at || 0;
  const lastCommit = skill.last_commit_at || 0;

  // Check for archive candidates first
  // Archived: 1 year no access + stars < 5 + 2 years no commit
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000;

  if (
    skill.stars < 5 &&
    lastAccess < oneYearAgo &&
    lastCommit < twoYearsAgo
  ) {
    return 'archived';
  }

  // Hot: stars >= 1000 OR accessed in last 7 days
  if (
    skill.stars >= TIER_CONFIG.hot.minStars ||
    (now - lastAccess) < TIER_CONFIG.hot.accessWindow
  ) {
    return 'hot';
  }

  // Warm: stars >= 100 OR accessed in last 30 days
  if (
    skill.stars >= TIER_CONFIG.warm.minStars ||
    (now - lastAccess) < TIER_CONFIG.warm.accessWindow
  ) {
    return 'warm';
  }

  // Cool: stars >= 10 OR accessed in last 90 days
  if (
    skill.stars >= TIER_CONFIG.cool.minStars ||
    (now - lastAccess) < TIER_CONFIG.cool.accessWindow
  ) {
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
 * Reset access counts for expired windows
 */
async function resetAccessCounts(env: TierRecalcEnv): Promise<void> {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Reset 7-day counts for skills not accessed in 7 days
  await env.DB.prepare(`
    UPDATE skills
    SET access_count_7d = 0
    WHERE last_accessed_at IS NULL OR last_accessed_at < ?
  `)
    .bind(sevenDaysAgo)
    .run();

  // Reset 30-day counts for skills not accessed in 30 days
  await env.DB.prepare(`
    UPDATE skills
    SET access_count_30d = 0
    WHERE last_accessed_at IS NULL OR last_accessed_at < ?
  `)
    .bind(thirtyDaysAgo)
    .run();

  console.log('Access counts reset completed');
}

/**
 * Recalculate tiers for all skills in batches
 */
async function recalculateTiers(env: TierRecalcEnv): Promise<{
  total: number;
  changed: number;
  byTier: Record<SkillTier, number>;
}> {
  const BATCH_SIZE = 1000;
  let offset = 0;
  let total = 0;
  let changed = 0;
  const byTier: Record<SkillTier, number> = {
    hot: 0,
    warm: 0,
    cool: 0,
    cold: 0,
    archived: 0,
  };

  while (true) {
    const skills = await env.DB.prepare(`
      SELECT id, stars, tier, last_accessed_at, access_count_7d, access_count_30d, last_commit_at
      FROM skills
      WHERE visibility = 'public'
      ORDER BY id
      LIMIT ? OFFSET ?
    `)
      .bind(BATCH_SIZE, offset)
      .all<SkillForTierCalc>();

    if (skills.results.length === 0) break;

    const updates: Array<{ id: string; tier: SkillTier; nextUpdateAt: number | null }> = [];

    for (const skill of skills.results) {
      const newTier = calculateTier(skill);
      byTier[newTier]++;
      total++;

      if (newTier !== skill.tier) {
        updates.push({
          id: skill.id,
          tier: newTier,
          nextUpdateAt: getNextUpdateTime(newTier),
        });
        changed++;
      }
    }

    // Batch update changed tiers
    if (updates.length > 0) {
      const now = Date.now();
      const statements = updates.map((u) =>
        env.DB.prepare(`
          UPDATE skills SET tier = ?, next_update_at = ?, updated_at = ? WHERE id = ?
        `).bind(u.tier, u.nextUpdateAt, now, u.id)
      );

      await env.DB.batch(statements);
    }

    offset += BATCH_SIZE;

    // Safety limit
    if (offset > 10000000) {
      console.warn('Tier recalculation hit safety limit');
      break;
    }
  }

  return { total, changed, byTier };
}

/**
 * Record metrics to KV
 */
async function recordMetrics(
  env: TierRecalcEnv,
  stats: { total: number; changed: number; byTier: Record<SkillTier, number> }
): Promise<void> {
  const dateKey = `metrics:tier-recalc:${new Date().toISOString().slice(0, 10)}`;

  await env.KV.put(dateKey, JSON.stringify({
    ...stats,
    timestamp: Date.now(),
  }), {
    expirationTtl: 30 * 24 * 60 * 60, // 30 days
  });
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: TierRecalcEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log('Tier Recalculation Worker triggered at:', new Date().toISOString());

    // 1. Reset expired access counts
    await resetAccessCounts(env);

    // 2. Recalculate all tiers
    const stats = await recalculateTiers(env);

    console.log(`Tier recalculation complete:
      Total: ${stats.total}
      Changed: ${stats.changed}
      Hot: ${stats.byTier.hot}
      Warm: ${stats.byTier.warm}
      Cool: ${stats.byTier.cool}
      Cold: ${stats.byTier.cold}
      Archived: ${stats.byTier.archived}
    `);

    // 3. Record metrics
    await recordMetrics(env, stats);

    console.log('Tier recalculation completed');
  },

  async fetch(
    request: Request,
    env: TierRecalcEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Metrics endpoint
    if (url.pathname === '/metrics') {
      const dateKey = `metrics:tier-recalc:${new Date().toISOString().slice(0, 10)}`;
      const metrics = await env.KV.get(dateKey, 'json');
      return new Response(JSON.stringify(metrics || {}), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};