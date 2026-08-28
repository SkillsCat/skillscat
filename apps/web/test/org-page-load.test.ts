import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/server/org/page', () => ({
  resolveOrgPagePayload: vi.fn(async () => ({
    status: 404,
    data: {
      slug: 'acme',
      org: null,
      members: [],
      skills: [],
      error: 'Organization not found',
      errorKind: 'not_found',
    },
  })),
}));

describe('org page load', () => {
  it('sets Cache-Control exactly once — SvelteKit throws on a conflicting duplicate', async () => {
    // Mimic SvelteKit's setHeaders: setting the same header twice with a
    // different value throws, which previously turned every org page into a 500.
    const seen = new Map<string, string>();
    const setHeaders = vi.fn((headers: Record<string, string>) => {
      for (const [key, value] of Object.entries(headers)) {
        const normalized = key.toLowerCase();
        if (seen.has(normalized) && seen.get(normalized) !== value) {
          throw new Error(`"${key}" header is already set`);
        }
        seen.set(normalized, value);
      }
    });

    const { load } = await import('../src/routes/org/[slug]/+page.server');
    const data = await load({
      params: { slug: 'acme' },
      platform: { env: {}, context: { waitUntil: vi.fn() } },
      setHeaders,
      locals: {},
    } as never);

    expect(data.error).toBe('Organization not found');
    expect(seen.get('cache-control')).toBe('no-store');
    expect(seen.get('x-skillscat-status-override')).toBe('404');
  });
});
