import type { SkillCardData } from '$lib/types';
import { getCached, invalidateCache } from '$lib/server/cache';
import { schedulePublicSkillVisibilityRecheck } from '$lib/server/skill/visibility';

type WaitUntilFn = (promise: Promise<unknown>) => void;

export async function resolvePublicSkillDataCache<T>(input: {
  db: D1Database | undefined;
  cacheKey: string;
  load: () => Promise<T>;
  ttlSeconds: number;
  getSkills: (data: T) => SkillCardData[];
  waitUntil?: WaitUntilFn;
}): Promise<{ data: T; hit: boolean }> {
  const cached = await getCached(
    input.cacheKey,
    input.load,
    input.ttlSeconds,
    { waitUntil: input.waitUntil }
  );

  const skills = input.getSkills(cached.data);
  if (!cached.hit || !input.db || skills.length === 0) {
    return cached;
  }

  // Serve the cached payload immediately and re-confirm visibility off the
  // critical path. A stale entry is invalidated so the next request reloads.
  schedulePublicSkillVisibilityRecheck({
    db: input.db,
    waitUntil: input.waitUntil,
    entries: [{
      ids: skills.map((skill) => skill.id),
      invalidate: () => invalidateCache(input.cacheKey),
    }],
  });

  return cached;
}
