import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../src/lib/server/marketplace/claude');
});

describe('claude marketplace mapping', () => {
  it('builds stable plugin names from skill slugs', async () => {
    const { buildClaudeMarketplacePluginName } = await import('../src/lib/server/marketplace/claude');
    const rootName = buildClaudeMarketplacePluginName('test-owner/demo-skill');
    const nestedName = buildClaudeMarketplacePluginName('test-owner/demo-skill/nested');

    expect(rootName).toMatch(/^skillscat-test-owner--demo-skill-[a-z0-9]{6}$/);
    expect(nestedName).toMatch(/^skillscat-test-owner--demo-skill--nested-[a-z0-9]{6}$/);
    expect(buildClaudeMarketplacePluginName('test-owner/demo-skill')).toBe(rootName);
    expect(nestedName).not.toBe(rootName);
  });

  it('maps root GitHub skills to github sources', async () => {
    const { buildClaudeMarketplacePluginSource } = await import('../src/lib/server/marketplace/claude');

    expect(
      buildClaudeMarketplacePluginSource({
        repoOwner: 'test-owner',
        repoName: 'demo-skill',
        skillPath: null,
        githubUrl: 'https://github.com/test-owner/demo-skill',
        commitSha: '0123456789abcdef0123456789abcdef01234567',
      })
    ).toEqual({
      source: 'github',
      repo: 'test-owner/demo-skill',
      sha: '0123456789abcdef0123456789abcdef01234567',
    });
  });

  it('maps nested git sources to git-subdir entries and publishes the skill root', async () => {
    const { buildClaudeMarketplacePlugin } = await import('../src/lib/server/marketplace/claude');
    const plugin = buildClaudeMarketplacePlugin({
      slug: 'test-owner/demo-skill/nested',
      name: 'Nested Demo',
      description: 'Install a nested demo skill.',
      repoOwner: 'test-owner',
      repoName: 'demo-skill',
      skillPath: '.claude/skills/nested',
      githubUrl: 'https://gitlab.com/test-owner/demo-skill',
      commitSha: null,
    });

    expect(plugin).toMatchObject({
      description: 'Install a nested demo skill.',
      homepage: 'https://skills.cat/skills/test-owner/demo-skill/nested',
      repository: 'https://gitlab.com/test-owner/demo-skill',
      strict: false,
      skills: ['./'],
      source: {
        source: 'git-subdir',
        url: 'https://gitlab.com/test-owner/demo-skill',
        path: '.claude/skills/nested',
      },
    });
    expect(plugin?.name).toMatch(/^skillscat-test-owner--demo-skill--nested-[a-z0-9]{6}$/);
  });
});

describe('marketplace route', () => {
  it('returns marketplace payload with cache headers', async () => {
    vi.doMock('../src/lib/server/marketplace/claude', () => ({
      resolveClaudeMarketplace: async () => ({
        data: {
          name: 'SkillsCat Marketplace',
          plugins: [{ name: 'skillscat-demo', source: { source: 'github', repo: 'test/demo' } }],
        },
        cacheControl: 'public, max-age=600',
        cacheStatus: 'MISS' as const,
        status: 200,
      }),
    }));

    const { GET } = await import('../src/routes/marketplace.json/+server');
    const response = await GET({
      platform: { env: {}, context: {} },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=600');
    expect(response.headers.get('x-cache')).toBe('MISS');
    await expect(response.json()).resolves.toEqual({
      name: 'SkillsCat Marketplace',
      plugins: [{ name: 'skillscat-demo', source: { source: 'github', repo: 'test/demo' } }],
    });
  });

  it('surfaces resolver failures as json errors', async () => {
    vi.doMock('../src/lib/server/marketplace/claude', () => ({
      resolveClaudeMarketplace: async () => ({
        data: null,
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS' as const,
        error: 'Database not available',
        status: 503,
      }),
    }));

    const { GET } = await import('../src/routes/marketplace.json/+server');
    const response = await GET({
      platform: { env: {}, context: {} },
    } as never);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
    await expect(response.json()).resolves.toEqual({
      error: 'Database not available',
    });
  });
});
