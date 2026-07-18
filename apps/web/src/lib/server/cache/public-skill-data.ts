import type { SkillCardData } from '$lib/types';
import { getCached, invalidateCache } from '$lib/server/cache';
import { getCurrentPublicSkillIds } from '$lib/server/skill/visibility';

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

  const skillIds = skills.map((skill) => skill.id);
  const currentPublicIds = await getCurrentPublicSkillIds(input.db, skillIds);
  if (currentPublicIds.size === new Set(skillIds).size) {
    return cached;
  }

  await invalidateCache(input.cacheKey);
  return {
    data: await input.load(),
    hit: false,
  };
}
