import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import {
  normalizeSitemapRefreshMinIntervalSeconds,
  refreshAllSitemapSnapshots,
} from '$lib/server/seo/sitemap';

const SITEMAP_REFRESH_STATE_KEY = 'seo:sitemaps:full-refresh:v1';
let inflightRefresh: Promise<{
  refreshed: string[];
  removed: string[];
}> | null = null;

export const POST: RequestHandler = async ({ request, platform }) => {
  const authHeader = request.headers.get('Authorization');
  const workerSecret = env?.WORKER_SECRET || platform?.env?.WORKER_SECRET;

  if (!workerSecret || authHeader !== `Bearer ${workerSecret}`) {
    throw error(401, 'Unauthorized');
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const kv = platform?.env?.KV;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  if (!db || !r2) {
    throw error(500, 'Database or storage not available');
  }

  const body = await request.json().catch(() => ({})) as { scope?: string; force?: boolean };
  if (body.scope && body.scope !== 'all') {
    throw error(400, 'Unsupported sitemap refresh scope');
  }

  const now = Date.now();
  const minIntervalSeconds = normalizeSitemapRefreshMinIntervalSeconds(
    platform?.env?.SITEMAP_REFRESH_MIN_INTERVAL_SECONDS
  );
  const lastRefreshRaw = kv ? await kv.get(SITEMAP_REFRESH_STATE_KEY) : null;
  const lastRefreshAt = lastRefreshRaw ? Number.parseInt(lastRefreshRaw, 10) : 0;
  const nextEligibleAt = lastRefreshAt > 0 ? lastRefreshAt + minIntervalSeconds * 1000 : 0;
  const shouldSkip = !body.force && lastRefreshAt > 0 && nextEligibleAt > now;

  if (shouldSkip) {
    return json({
      success: true,
      scope: 'all',
      skipped: true,
      minIntervalSeconds,
      lastRefreshAt,
      nextEligibleAt,
      refreshed: [],
      removed: [],
    });
  }

  if (!inflightRefresh) {
    inflightRefresh = refreshAllSitemapSnapshots({
      db,
      r2,
      waitUntil,
    }).finally(() => {
      inflightRefresh = null;
    });
  }

  const summary = await inflightRefresh;
  const refreshedAt = Date.now();

  if (kv) {
    await kv.put(SITEMAP_REFRESH_STATE_KEY, String(refreshedAt));
  }

  return json({
    success: true,
    scope: 'all',
    skipped: false,
    minIntervalSeconds,
    lastRefreshAt: refreshedAt,
    refreshed: summary.refreshed,
    removed: summary.removed,
  });
};
