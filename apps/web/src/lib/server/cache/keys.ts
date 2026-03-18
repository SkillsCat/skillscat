export const HOME_CRITICAL_CACHE_KEY = 'page:home:critical:v1';
export const LEGACY_HOME_CACHE_KEY = 'page:home:v1';
export const PUBLIC_SKILLS_STATS_CACHE_KEY = 'stats:public-skills:v1';

export const PUBLIC_DISCOVERY_PAGE_CACHE_KEYS = [
  HOME_CRITICAL_CACHE_KEY,
  PUBLIC_SKILLS_STATS_CACHE_KEY,
  'page:trending:v1:1',
  'page:recent:v1:1',
  'page:top:v1:1',
  'page:categories:v1',
] as const;

export const PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS = [
  LEGACY_HOME_CACHE_KEY,
  ...PUBLIC_DISCOVERY_PAGE_CACHE_KEYS,
] as const;
