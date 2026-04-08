export type RealtimeRecommendMode = 'full' | 'lightweight';

export const RECOMMEND_LIGHTWEIGHT_FALLBACK_COOLDOWN_MS = 60 * 60 * 1000;
const RECOMMEND_ONLINE_CACHE_KEY_VERSION = 'v2';

function buildLegacyOnlineRecommendCacheKey(skillId: string, mode: RealtimeRecommendMode): string {
  return `recommend:${skillId}:${mode}`;
}

export function getRealtimeRecommendMode(
  visibility: 'public' | 'private' | 'unlisted' | null | undefined,
  tier: string | null | undefined,
  forceRefresh: boolean
): RealtimeRecommendMode {
  if (forceRefresh || visibility !== 'public') {
    return 'full';
  }

  return tier === 'hot' || tier === 'warm' ? 'full' : 'lightweight';
}

export function shouldLoadRecommendSignals(mode: RealtimeRecommendMode): boolean {
  return mode === 'full';
}

export function buildOnlineRecommendCacheKey(skillId: string, mode: RealtimeRecommendMode): string {
  return `recommend:online:${RECOMMEND_ONLINE_CACHE_KEY_VERSION}:${skillId}:${mode}`;
}

export function getOnlineRecommendCacheKeys(skillId: string): string[] {
  return [
    buildOnlineRecommendCacheKey(skillId, 'full'),
    buildOnlineRecommendCacheKey(skillId, 'lightweight'),
    buildLegacyOnlineRecommendCacheKey(skillId, 'full'),
    buildLegacyOnlineRecommendCacheKey(skillId, 'lightweight'),
    `recommend:${skillId}`,
  ];
}

export function shouldMarkLightweightRecommendFallback(
  lastFallbackAt: number | null | undefined,
  now: number = Date.now(),
  cooldownMs: number = RECOMMEND_LIGHTWEIGHT_FALLBACK_COOLDOWN_MS
): boolean {
  return lastFallbackAt == null || lastFallbackAt + cooldownMs <= now;
}
