import type { DbEnv } from '$lib/server/db/shared/types';

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

type SkillTier = keyof typeof TIER_CONFIG;

const ACCESS_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const NEEDS_UPDATE_MARK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACCESS_DEDUPE_ENTRIES = 10_000;
const MAX_MARKED_UPDATE_ENTRIES = 5_000;

const recentAccessByClient = new Map<string, number>();
const recentNeedsUpdateMark = new Map<string, number>();

function pruneExpiredEntries(map: Map<string, number>, now: number, windowMs: number): void {
  for (const [key, timestamp] of map.entries()) {
    if (now - timestamp > windowMs) {
      map.delete(key);
    }
  }
}

function shouldSkipAccessCount(
  skillId: string,
  clientKey: string | undefined,
  now: number
): boolean {
  if (!clientKey) return false;

  const dedupeKey = `${skillId}:${clientKey}`;
  const lastSeen = recentAccessByClient.get(dedupeKey);

  if (lastSeen && now - lastSeen < ACCESS_DEDUPE_WINDOW_MS) {
    return true;
  }

  recentAccessByClient.set(dedupeKey, now);
  if (recentAccessByClient.size > MAX_ACCESS_DEDUPE_ENTRIES) {
    pruneExpiredEntries(recentAccessByClient, now, ACCESS_DEDUPE_WINDOW_MS);
  }

  return false;
}

function shouldWriteNeedsUpdateMarker(skillId: string, now: number): boolean {
  const lastMarkedAt = recentNeedsUpdateMark.get(skillId);
  if (lastMarkedAt && now - lastMarkedAt < NEEDS_UPDATE_MARK_WINDOW_MS) {
    return false;
  }

  recentNeedsUpdateMark.set(skillId, now);
  if (recentNeedsUpdateMark.size > MAX_MARKED_UPDATE_ENTRIES) {
    pruneExpiredEntries(recentNeedsUpdateMark, now, NEEDS_UPDATE_MARK_WINDOW_MS);
  }

  return true;
}

/**
 * Record skill access and check if update is needed
 * This is called asynchronously when a user views a skill detail page
 */
export async function recordSkillAccess(
  env: DbEnv,
  skillId: string,
  clientKey?: string
): Promise<void> {
  if (!env.DB) return;

  const now = Date.now();
  if (shouldSkipAccessCount(skillId, clientKey, now)) {
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

    // Update access tracking
    await env.DB.prepare(`
      UPDATE skills
      SET last_accessed_at = ?,
          access_count_7d = access_count_7d + 1,
          access_count_30d = access_count_30d + 1
      WHERE id = ?
    `)
      .bind(now, skillId)
      .run();

    // Check if update is needed based on tier
    const tier = skill.tier || 'cold';
    const updateInterval = TIER_CONFIG[tier]?.updateInterval || TIER_CONFIG.cold.updateInterval;

    // Handle archived skills - check for resurrection
    if (tier === 'archived') {
      // Trigger resurrection check asynchronously
      checkAndResurrect(env, skillId).catch(console.error);
      return;
    }

    // Check if skill needs update
    const needsUpdate =
      !skill.next_update_at ||
      skill.next_update_at < now ||
      (tier === 'cold' && (!skill.last_accessed_at || now - skill.last_accessed_at > updateInterval));

    if (needsUpdate && env.KV && shouldWriteNeedsUpdateMarker(skillId, now)) {
      // Mark for update in KV (will be processed by trending worker)
      await env.KV.put(`needs_update:${skillId}`, '1', {
        expirationTtl: 60 * 60, // 1 hour TTL
      });
    }
  } catch (error) {
    console.error('Error recording skill access:', error);
  }
}

/**
 * Check if an archived skill should be resurrected
 * Called when a user accesses an archived skill
 */
async function checkAndResurrect(env: DbEnv, skillId: string): Promise<void> {
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
