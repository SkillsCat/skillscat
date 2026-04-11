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
import { getNextRecommendUpdateAt } from '../src/lib/server/ranking/recommend-precompute';
import { isImmediateRefreshNextUpdateAt } from '../src/lib/server/db/business/access';

interface TierRecalcEnv extends BaseEnv {}

interface SkillForTierCalc {
  id: string;
  stars: number;
  tier: SkillTier;
  next_update_at: number | null;
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

export function resolveTierRecalcNextUpdateAt(
  currentNextUpdateAt: number | null,
  nextTier: SkillTier
): number | null {
  if (isImmediateRefreshNextUpdateAt(currentNextUpdateAt)) {
    return currentNextUpdateAt;
  }

  return getNextUpdateTime(nextTier);
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
    WHERE access_count_7d != 0
      AND (last_accessed_at IS NULL OR last_accessed_at < ?)
  `)
    .bind(sevenDaysAgo)
    .run();

  // Reset 30-day counts for skills not accessed in 30 days
  await env.DB.prepare(`
    UPDATE skills
    SET access_count_30d = 0
    WHERE access_count_30d != 0
      AND (last_accessed_at IS NULL OR last_accessed_at < ?)
  `)
    .bind(thirtyDaysAgo)
    .run();

  // Note: download_count_7d and download_count_30d are computed as true rolling
  // window sums by the trending worker's flushDownloadCounts() — no decay needed here.

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
  let lastSeenId: string | null = null;
  let scanned = 0;
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
    let rows: SkillForTierCalc[] = [];
    if (lastSeenId) {
      const result = await env.DB.prepare(`
        SELECT id, stars, tier, next_update_at, last_accessed_at, access_count_7d, access_count_30d, last_commit_at
        FROM skills
        WHERE visibility = 'public' AND id > ?
        ORDER BY id
        LIMIT ?
      `)
        .bind(lastSeenId, BATCH_SIZE)
        .all<SkillForTierCalc>();
      rows = result.results || [];
    } else {
      const result = await env.DB.prepare(`
        SELECT id, stars, tier, next_update_at, last_accessed_at, access_count_7d, access_count_30d, last_commit_at
        FROM skills
        WHERE visibility = 'public'
        ORDER BY id
        LIMIT ?
      `)
        .bind(BATCH_SIZE)
        .all<SkillForTierCalc>();
      rows = result.results || [];
    }

    if (rows.length === 0) break;
    scanned += rows.length;

    const updates: Array<{ id: string; tier: SkillTier; nextUpdateAt: number | null }> = [];

    for (const skill of rows) {
      const newTier = calculateTier(skill);
      byTier[newTier]++;
      total++;

      if (newTier !== skill.tier) {
        updates.push({
          id: skill.id,
          tier: newTier,
          nextUpdateAt: resolveTierRecalcNextUpdateAt(skill.next_update_at, newTier),
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

      const recommendStateStatements = updates.map((u) =>
        env.DB.prepare(`
          INSERT INTO skill_recommend_state (
            skill_id, dirty, next_update_at, precomputed_at, algo_version,
            fail_count, last_error_at, last_fallback_at, created_at, updated_at
          )
          VALUES (?, 0, ?, NULL, NULL, 0, NULL, NULL, ?, ?)
          ON CONFLICT(skill_id) DO UPDATE SET
            next_update_at = excluded.next_update_at,
            updated_at = excluded.updated_at
        `).bind(
          u.id,
          getNextRecommendUpdateAt(u.tier, now),
          now,
          now
        )
      );

      await env.DB.batch(recommendStateStatements);
    }

    lastSeenId = rows[rows.length - 1]?.id || lastSeenId;

    // Safety limit
    if (scanned > 10000000) {
      console.warn('Tier recalculation hit safety limit');
      break;
    }
  }

  return { total, changed, byTier };
}

function recordMetrics(
  env: TierRecalcEnv,
  stats: { total: number; changed: number; byTier: Record<SkillTier, number> }
): void {
  if (!env.WORKER_ANALYTICS) {
    return;
  }

  try {
    env.WORKER_ANALYTICS.writeDataPoint({
      blobs: ['scheduled'],
      doubles: [
        stats.total,
        stats.changed,
        stats.byTier.hot,
        stats.byTier.warm,
        stats.byTier.cool,
        stats.byTier.cold,
        stats.byTier.archived,
      ],
      indexes: ['tier-recalc-run'],
    });
  } catch (error) {
    console.error('Failed to write tier-recalc analytics datapoint:', error);
  }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: TierRecalcEnv,
    _ctx: ExecutionContext
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
};
