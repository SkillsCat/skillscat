import { describe, expect, it, vi, afterEach } from 'vitest';
import { error as httpError } from '@sveltejs/kit';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../src/lib/server/registry/repo');
  vi.unmock('../src/lib/server/registry/search');
});

describe('registry route error handling', () => {
  it('preserves 403 for registry repo scope failures', async () => {
    vi.doMock('../src/lib/server/registry/repo', () => ({
      parseRegistryRepoInput: () => ({ owner: 'testowner', repo: 'testrepo', pathFilter: null }),
      resolveRegistryRepo: async () => {
        throw httpError(403, "Scope 'read' required");
      },
    }));

    const { GET } = await import('../src/routes/registry/repo/[owner]/[repo]/+server');
    const response = await GET({
      params: { owner: 'testowner', repo: 'testrepo' },
      platform: undefined,
      request: new Request('https://skills.cat/registry/repo/testowner/testrepo'),
      locals: {},
      url: new URL('https://skills.cat/registry/repo/testowner/testrepo'),
    } as never);

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain('Authorization');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
    await expect(response.json()).resolves.toEqual({ error: "Scope 'read' required" });
  });

  it('preserves 403 for registry search scope failures', async () => {
    vi.doMock('../src/lib/server/registry/search', () => ({
      parseRegistrySearchInput: () => ({
        query: 'Public',
        category: '',
        limit: 20,
        offset: 0,
        includePrivate: true,
      }),
      resolveRegistrySearch: async () => {
        throw httpError(403, "Scope 'read' required");
      },
    }));

    const { GET } = await import('../src/routes/registry/search/+server');
    const response = await GET({
      platform: undefined,
      request: new Request('https://skills.cat/registry/search?q=Public&include_private=true'),
      locals: {},
      url: new URL('https://skills.cat/registry/search?q=Public&include_private=true'),
    } as never);

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain('Authorization');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
    await expect(response.json()).resolves.toEqual({ error: "Scope 'read' required" });
  });
});
