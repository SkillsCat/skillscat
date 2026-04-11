import type { DbEnv } from '$lib/server/db/shared/types';
import { shouldRecordSkillAccess } from '$lib/server/skill/access';

// Tier configuration (must match workers/types.ts)
const TIER_CONFIG = {
  hot: {
    updateInterval: 6 * 60 * 60 * 1000,      // 6 hours
    accessWindow: 7 * 24 * 60 * 60 * 1000,   // 7 days
  },
  warm: {
    updateInterval: 24 * 60 * 60 * 1000,     // 24 hours
    accessWindow: 30 * 24 * 60 * 60 * 1000,  // 30 days
  },
  cool: {
    updateInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
    accessWindow: 90 * 24 * 60 * 60 * 1000,  // 90 days
  },
  cold: {
    updateInterval: 30 * 24 * 60 * 60 * 1000, // 30 days for cold (on-access)
    accessWindow: 365 * 24 * 60 * 60 * 1000, // 1 year
  },
  archived: {
    updateInterval: 0,
    accessWindow: 0,
  },
} as const;

export type SkillTier = keyof typeof TIER_CONFIG;

// Negative values are reserved for "refresh immediately" markers. We encode the
// access timestamp so marked rows can still be processed in a stable order.
export function isImmediateRefreshNextUpdateAt(nextUpdateAt: number | null | undefined): boolean {
  return typeof nextUpdateAt === 'number' && nextUpdateAt < 0;
}

export function buildImmediateRefreshNextUpdateAt(occurredAt: number): number {
  const normalizedOccurredAt = Number.isFinite(occurredAt)
    ? Math.max(1, Math.floor(occurredAt))
    : Date.now();
  return -normalizedOccurredAt;
}

export function getSkillUpdateInterval(tier: SkillTier | null | undefined): number {
  const normalizedTier = tier || 'cold';
  return TIER_CONFIG[normalizedTier]?.updateInterval || TIER_CONFIG.cold.updateInterval;
}

export function shouldMarkSkillNeedsUpdate(input: {
  tier: SkillTier | null | undefined;
  nextUpdateAt: number | null;
  lastAccessedAt: number | null;
  occurredAt: number;
}): boolean {
  if (isImmediateRefreshNextUpdateAt(input.nextUpdateAt)) {
    return false;
  }

  const tier = input.tier || 'cold';
  if (tier === 'archived') {
    return false;
  }

  const updateInterval = getSkillUpdateInterval(tier);

  return (
    !input.nextUpdateAt ||
    input.nextUpdateAt < input.occurredAt ||
    (tier === 'cold' && (!input.lastAccessedAt || input.occurredAt - input.lastAccessedAt > updateInterval))
  );
}

export function resolveNextUpdateAtAfterAccess(input: {
  tier: SkillTier | null | undefined;
  nextUpdateAt: number | null;
  lastAccessedAt: number | null;
  occurredAt: number;
}): number | null {
  if (!shouldMarkSkillNeedsUpdate(input)) {
    return input.nextUpdateAt;
  }

  return buildImmediateRefreshNextUpdateAt(input.occurredAt);
}

/**
 * Record skill access and check if update is needed
 * This is called asynchronously when a user views a skill detail page
 */
export async function recordSkillAccess(
  env: DbEnv,
  skillId: string,
  clientKey?: string,
  options?: {
    skipClientDedupe?: boolean;
  }
): Promise<void> {
  if (!env.DB) return;

  const now = Date.now();
  if (!options?.skipClientDedupe && !shouldRecordSkillAccess(skillId, clientKey, now)) {
    return;
  }

  try {
    // Get current skill data
    const skill = await env.DB.prepare(`
      SELECT tier, next_update_at, last_accessed_at
      FROM skills WHERE id = ?
    `)
      .bind(skillId)
      .first<{
        tier: SkillTier;
        next_update_at: number | null;
        last_accessed_at: number | null;
      }>();

    if (!skill) return;

    const tier = skill.tier || 'cold';

    // Update access tracking
    const nextUpdateAt = resolveNextUpdateAtAfterAccess({
      tier,
      nextUpdateAt: skill.next_update_at,
      lastAccessedAt: skill.last_accessed_at,
      occurredAt: now,
    });

    await env.DB.prepare(`
      UPDATE skills
      SET last_accessed_at = ?,
          access_count_7d = access_count_7d + 1,
          access_count_30d = access_count_30d + 1,
          next_update_at = ?
      WHERE id = ?
    `)
      .bind(now, nextUpdateAt, skillId)
      .run();

    // Handle archived skills - check for resurrection
    if (tier === 'archived') {
      // Trigger resurrection check asynchronously
      queueArchivedSkillResurrectionCheck(env, skillId).catch(console.error);
      return;
    }

  } catch (error) {
    console.error('Error recording skill access:', error);
  }
}

/**
 * Check if an archived skill should be resurrected
 * Called when a user accesses an archived skill
 */
export async function queueArchivedSkillResurrectionCheck(env: DbEnv, skillId: string): Promise<void> {
  // If resurrection worker URL is configured, call it
  if (env.RESURRECTION_WORKER_URL && env.WORKER_SECRET) {
    try {
      const response = await fetch(`${env.RESURRECTION_WORKER_URL}/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.WORKER_SECRET}`,
        },
        body: JSON.stringify({ skillId }),
      });

      if (response.ok) {
        const result = await response.json() as { resurrected: boolean; reason?: string };
        if (result.resurrected) {
          console.log(`Skill ${skillId} resurrected via worker`);
        }
      }
    } catch (error) {
      console.error('Error calling resurrection worker:', error);
    }
    return;
  }

  // Fallback: Mark for resurrection check in KV
  // This will be picked up by the resurrection worker on next run
  if (env.KV) {
    await env.KV.put(`needs_resurrection_check:${skillId}`, '1', {
      expirationTtl: 24 * 60 * 60, // 24 hour TTL
    });
  }
}

/**
 * Reset access counts (called by tier-recalc worker daily)
 */
export async function resetAccessCounts(env: DbEnv): Promise<void> {
  if (!env.DB) return;

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
}
