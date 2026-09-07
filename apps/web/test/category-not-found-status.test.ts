import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCached } = vi.hoisted(() => ({ getCached: vi.fn() }));
vi.mock('$lib/server/cache', () => ({ getCached, invalidateCache: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('missing category status', () => {
  it.each([false, true])('returns the not-found payload without duplicate headers (cache hit: %s)', async (hit) => {
    const payload = { category: null, skills: [], pagination: null, isDynamic: false };
    getCached.mockImplementation(async (_key: string, load: () => Promise<unknown>) => ({
      data: hit ? payload : await load(),
      hit,
    }));
    const headers = new Map<string, string>();
    const { load } = await import('../src/routes/category/[slug]/+page.server');
    const result = await load({
      params: { slug: 'missing-category' },
      url: new URL('https://skills.cat/category/missing-category'),
      request: new Request('https://skills.cat/category/missing-category'),
      locals: { user: null },
      setHeaders(next: Record<string, string>) {
        for (const [key, value] of Object.entries(next)) {
          if (headers.has(key)) throw new Error(`"${key}" header is already set`);
          headers.set(key, value);
        }
      },
    } as never);
    expect(result).toEqual(payload);
    expect(headers.get('X-Skillscat-Status-Override')).toBe('404');
  });
});
