import { CACHE_VERSION_PATTERN } from '$lib/server/db/shared/constants';

export function buildListCacheKeys(key: string, cacheVersion?: string): string[] {
  if (key === 'top') key = 'top-quality-v1';
  if (key === 'recent') key = 'recent-quality-v1';
  const normalizedVersion = (cacheVersion || '').trim();
  const keys: string[] = [];

  if (normalizedVersion && CACHE_VERSION_PATTERN.test(normalizedVersion)) {
    keys.push(`cache/lists/${normalizedVersion}/${key}.json`);
  }

  keys.push(`cache/${key}.json`);
  return keys;
}
