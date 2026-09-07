import { CACHE_VERSION_PATTERN } from '$lib/server/db/shared/constants';

export function buildListCacheKeys(key: string, cacheVersion?: string): string[] {
  if (key === 'recent') key = 'recent-v2';
  const normalizedVersion = (cacheVersion || '').trim();
  const keys: string[] = [];

  if (normalizedVersion && CACHE_VERSION_PATTERN.test(normalizedVersion)) {
    keys.push(`cache/lists/${normalizedVersion}/${key}.json`);
  }

  keys.push(`cache/${key}.json`);
  return keys;
}
