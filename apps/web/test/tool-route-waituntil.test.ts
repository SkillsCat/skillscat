import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../src/lib/server/registry/search');
  vi.unmock('../src/lib/server/registry/repo');
  vi.unmock('../src/lib/server/skill/files');
});

describe('tool route waitUntil wiring', () => {
  it('passes waitUntil to search-skills POST', async () => {
    const waitUntil = vi.fn();
    const resolveRegistrySearch = vi.fn(async () => ({
      data: { skills: [], total: 0 },
      cacheControl: 'public, max-age=30',
      cacheStatus: 'MISS' as const,
    }));

    vi.doMock('../src/lib/server/registry/search', () => ({
      parseRegistrySearchInput: () => ({ query: '', category: '', limit: 20, offset: 0, includePrivate: false }),
      resolveRegistrySearch,
    }));

    const { POST } = await import('../src/routes/api/tools/search-skills/+server');
    const response = await POST({
      platform: { env: {}, context: { waitUntil } },
      request: new Request('https://skills.cat/api/tools/search-skills', { method: 'POST', body: '{}' }),
      locals: {},
    } as never);

    expect(resolveRegistrySearch).toHaveBeenCalledWith(
      expect.objectContaining({ waitUntil: expect.any(Function) }),
      expect.any(Object)
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
  });

  it('passes waitUntil to resolve-repo-skills POST', async () => {
    const waitUntil = vi.fn();
    const resolveRegistryRepo = vi.fn(async () => ({
      data: { skills: [], total: 0 },
      cacheControl: 'public, max-age=60',
      cacheStatus: 'MISS' as const,
    }));

    vi.doMock('../src/lib/server/registry/repo', () => ({
      parseRegistryRepoInput: () => ({ owner: 'testowner', repo: 'testrepo', pathFilter: null }),
      resolveRegistryRepo,
    }));

    const { POST } = await import('../src/routes/api/tools/resolve-repo-skills/+server');
    const response = await POST({
      platform: { env: {}, context: { waitUntil } },
      request: new Request('https://skills.cat/api/tools/resolve-repo-skills', { method: 'POST', body: '{}' }),
      locals: {},
    } as never);

    expect(resolveRegistryRepo).toHaveBeenCalledWith(
      expect.objectContaining({ waitUntil: expect.any(Function) }),
      expect.any(Object)
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
  });

  it('passes waitUntil to get-skill-files POST', async () => {
    const waitUntil = vi.fn();
    const resolveSkillFiles = vi.fn(async () => ({
      data: { folderName: 'test-skill', files: [{ path: 'SKILL.md', content: '# Test' }] },
      cacheControl: 'public, max-age=300',
      cacheStatus: 'MISS' as const,
    }));

    vi.doMock('../src/lib/server/skill/files', () => ({
      parseSkillFilesInput: () => ({ slug: 'testowner/testrepo' }),
      resolveSkillFiles,
    }));

    const { POST } = await import('../src/routes/api/tools/get-skill-files/+server');
    const response = await POST({
      platform: { env: {}, context: { waitUntil } },
      request: new Request('https://skills.cat/api/tools/get-skill-files', { method: 'POST', body: '{}' }),
      locals: {},
    } as never);

    expect(resolveSkillFiles).toHaveBeenCalledWith(
      expect.objectContaining({ waitUntil: expect.any(Function) }),
      expect.any(Object)
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
  });
});
