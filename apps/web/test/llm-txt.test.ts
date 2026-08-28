import { describe, expect, it, vi } from 'vitest';
import { buildLlmTxt } from '../src/lib/server/agent/llm-txt';
import { getCoreSitemapPages } from '../src/lib/server/seo/sitemap';

describe('buildLlmTxt', () => {
  it('documents the canonical machine endpoints and install guidance', () => {
    const text = buildLlmTxt();

    expect(text).toContain('CANONICAL_BASE_URL: https://skills.cat');
    expect(text).toContain('The standards-proposed /llms.txt filename is an alias');
    expect(text).toContain('GET https://skills.cat/registry/search?q=<query>&limit=<n>');
    expect(text).toContain('POST https://skills.cat/api/tools/search-skills');
    expect(text).toContain('POST https://skills.cat/api/tools/resolve-repo-skills');
    expect(text).toContain('POST https://skills.cat/api/tools/get-skill-files');
    expect(text).toContain('POST https://skills.cat/mcp');
    expect(text).toContain('the primary install artifact is the full skill bundle, not just SKILL.md');
    expect(text).toContain('MCP is an additional integration surface over the same data, not a separate content source');
    expect(text).toContain('GET https://skills.cat/api/skills/<slug>/files');
    expect(text).toContain('This currently only guarantees SKILL.md in the zip payload.');
    expect(text).toContain('project-local: <workspace>/skills/<folderName>/');
    expect(text).toContain('global: ~/.openclaw/skills/<folderName>/');
    expect(text).toContain('no global install is required; prefer npx for one-off installs');
    expect(text).toContain('npx skillscat add <slug>');
    expect(text).toContain('npx skillscat info <owner>/<repo>');
    expect(text).toContain('If terminal access is available, prefer the SkillsCat CLI over manual file writes.');
    expect(text).toContain('npx skillscat add <slug> --agent openclaw');
    expect(text).toContain('discover candidate slugs with: npx skillscat search "<query>" or npx skillscat info <owner>/<repo>');
    expect(text).toContain('run npx skillscat login first, then re-run the add command');
  });
});

describe('getCoreSitemapPages', () => {
  it('keeps the machine guide out of search-engine sitemaps', () => {
    expect(getCoreSitemapPages().some((page) => page.url === '/llm.txt')).toBe(false);
  });
});

describe('llm.txt route', () => {
  it('serves the guide while excluding it from search indexes', async () => {
    vi.doMock('../src/lib/server/cache', () => ({
      getCachedText: async () => ({ data: 'machine guide', hit: false }),
    }));

    const { GET } = await import('../src/routes/llm.txt/+server');
    const response = await GET({ platform: { context: {} } } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow, noarchive');
    await expect(response.text()).resolves.toBe('machine guide');
  });

  it('serves the plural standards-compatible alias with the same policy', async () => {
    vi.doMock('../src/lib/server/cache', () => ({
      getCachedText: async () => ({ data: 'machine guide', hit: false }),
    }));

    const { GET } = await import('../src/routes/llms.txt/+server');
    const response = await GET({ platform: { context: {} } } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow, noarchive');
    await expect(response.text()).resolves.toBe('machine guide');
  });
});
