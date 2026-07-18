import { peekCachedText, putCachedText } from '$lib/server/cache';

const REGISTRY_SEARCH_REVISION_CACHE_KEY = 'registry:search:revision:v1';
const REGISTRY_SEARCH_REVISION_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function getRegistrySearchCacheRevision(
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<string> {
  return await peekCachedText(REGISTRY_SEARCH_REVISION_CACHE_KEY, { waitUntil }) || '0';
}

export async function bumpRegistrySearchCacheRevision(): Promise<void> {
  await putCachedText(
    REGISTRY_SEARCH_REVISION_CACHE_KEY,
    `${Date.now()}:${crypto.randomUUID()}`,
    REGISTRY_SEARCH_REVISION_TTL_SECONDS,
    { awaitWrite: true }
  );
}
