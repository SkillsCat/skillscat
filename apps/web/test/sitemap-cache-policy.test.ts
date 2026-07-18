import { beforeEach, describe, expect, it, vi } from 'vitest';

const { peekCachedText, putCachedText } = vi.hoisted(() => ({
  peekCachedText: vi.fn(),
  putCachedText: vi.fn(),
}));

vi.mock('$lib/server/cache', () => ({
  invalidateCache: vi.fn(),
  peekCachedText,
  putCachedText,
}));

import {
  createCachedSitemapResponse,
  hasCompletedSitemapFullRefresh,
  refreshAllSitemapSnapshots,
  refreshPrioritySitemapSnapshots,
  shouldRunSitemapFullRefresh,
} from '../src/lib/server/seo/sitemap';

function createRefreshDbMock() {
  return {
    prepare(query: string) {
      const normalized = query.replace(/\s+/g, ' ').trim();
      return {
        bind() {
          return {
            first: async () => {
              const isSkillCount = normalized.includes('FROM skills s')
                && normalized.includes('COUNT(*) AS count')
                && !normalized.includes('skill_freshness')
                && !normalized.includes('>= ?');
              return isSkillCount ? { count: 1, max_ts: 1000 } : { count: 0, max_ts: null };
            },
            all: async () => {
              if (normalized.includes('FROM category_public_stats')) {
                return { results: [] };
              }
              if (normalized.includes('ORDER BY slug ASC') && !normalized.includes('sort_ts')) {
                return {
                  results: [{
                    slug: 'acme/demo-skill',
                    updated_at: 1000,
                    indexed_at: 1000,
                    last_commit_at: null,
                  }],
                };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function createRefreshR2Mock(putKeys: string[]) {
  return {
    put: vi.fn(async (key: string) => {
      putKeys.push(key);
    }),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
    delete: vi.fn(async () => undefined),
  } as unknown as R2Bucket;
}

describe('sitemap snapshot policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    peekCachedText.mockResolvedValue(null);
    putCachedText.mockResolvedValue(undefined);
  });

  it('uses a dedicated versioned object as the completed full-refresh marker', async () => {
    const head = vi.fn(async () => ({ key: 'index' }));

    await expect(hasCompletedSitemapFullRefresh({ head } as unknown as R2Bucket)).resolves.toBe(true);
    expect(head).toHaveBeenCalledWith('cache/sitemaps/v2/full-refresh-complete');
    await expect(hasCompletedSitemapFullRefresh(undefined)).resolves.toBe(false);
  });

  it('retries a missing or stale full-refresh marker outside the scheduled hour', async () => {
    const head = vi.fn(async () => null);
    const r2 = { head } as unknown as R2Bucket;

    await expect(shouldRunSitemapFullRefresh(r2, {
      now: Date.parse('2026-07-18T04:15:00.000Z'),
      scheduledHourUtc: 3,
    })).resolves.toBe(true);

    head.mockResolvedValue({
      customMetadata: { generatedAt: String(Date.parse('2026-07-17T00:00:00.000Z')) },
    } as never);
    await expect(shouldRunSitemapFullRefresh(r2, {
      now: Date.parse('2026-07-18T04:15:00.000Z'),
      scheduledHourUtc: 3,
    })).resolves.toBe(true);
  });

  it('keeps a fresh marker on priority refreshes outside the scheduled hour', async () => {
    const head = vi.fn(async () => ({
      customMetadata: { generatedAt: String(Date.parse('2026-07-18T03:05:00.000Z')) },
    }));

    await expect(shouldRunSitemapFullRefresh({ head } as unknown as R2Bucket, {
      now: Date.parse('2026-07-18T04:15:00.000Z'),
      scheduledHourUtc: 3,
    })).resolves.toBe(false);
  });

  it('runs the scheduled full refresh even when the previous marker is fresh', async () => {
    const head = vi.fn(async () => ({
      customMetadata: { generatedAt: String(Date.parse('2026-07-18T02:15:00.000Z')) },
    }));

    await expect(shouldRunSitemapFullRefresh({ head } as unknown as R2Bucket, {
      now: Date.parse('2026-07-18T03:15:00.000Z'),
      scheduledHourUtc: 3,
    })).resolves.toBe(true);
  });

  it('serves a stale index snapshot without publishing an on-request rebuild', async () => {
    const fetcher = vi.fn(async () => '<new-index />');
    const r2 = {
      get: vi.fn(async () => ({
        text: async () => '<stable-index />',
        customMetadata: { generatedAt: '1' },
      })),
    } as unknown as R2Bucket;

    const response = await createCachedSitemapResponse({
      cacheKey: 'sitemap:v2:index:xml',
      ttl: 86400,
      cacheControl: 'public, max-age=300, s-maxage=3600',
      fetcher,
      debugTag: 'index',
      r2,
      snapshotMaxAgeSeconds: 1,
      refreshStaleSnapshot: false,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-cache')).toBe('STALE');
    await expect(response.text()).resolves.toBe('<stable-index />');
    expect(fetcher).not.toHaveBeenCalled();
    expect(putCachedText).toHaveBeenCalledOnce();
    expect(peekCachedText).toHaveBeenCalledWith(
      'sitemap:v2:index:xml',
      expect.objectContaining({ allowLegacyFallback: false })
    );
  });

  it('publishes the full sitemap index only after all referenced shards', async () => {
    const putKeys: string[] = [];

    await refreshAllSitemapSnapshots({
      db: createRefreshDbMock() as never,
      r2: createRefreshR2Mock(putKeys),
    });

    const shardIndex = putKeys.indexOf('cache/sitemaps/v2/sitemap:v2:skills:1:xml.xml');
    const indexIndex = putKeys.indexOf('cache/sitemaps/v2/sitemap:v2:index:xml.xml');
    expect(shardIndex).toBeGreaterThanOrEqual(0);
    expect(indexIndex).toBeGreaterThan(shardIndex);
    expect(putKeys).toContain('cache/sitemaps/v2/sitemap:v2:recent:skills:xml.xml');
    expect(putKeys).not.toContain('cache/sitemaps/v2/sitemap:v2:recent:profiles:xml.xml');
    expect(putKeys).not.toContain('cache/sitemaps/v2/sitemap:v2:recent:orgs:xml.xml');
    expect(putKeys.at(-1)).toBe('cache/sitemaps/v2/full-refresh-complete');
  });

  it('does not rewrite the full index during an hourly priority refresh', async () => {
    const putKeys: string[] = [];

    await refreshPrioritySitemapSnapshots({
      db: createRefreshDbMock() as never,
      r2: createRefreshR2Mock(putKeys),
    });

    expect(putKeys).not.toContain('cache/sitemaps/v2/sitemap:v2:index:xml.xml');
    expect(putKeys).toContain('cache/sitemaps/v2/sitemap:v2:recent:skills:xml.xml');
    expect(putKeys).not.toContain('cache/sitemaps/v2/sitemap:v2:recent:profiles:xml.xml');
    expect(putKeys).not.toContain('cache/sitemaps/v2/sitemap:v2:recent:orgs:xml.xml');
    expect(putCachedText).toHaveBeenCalledWith(
      'sitemap:v2:recent:skills:xml',
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ awaitWrite: true })
    );
  });
});
