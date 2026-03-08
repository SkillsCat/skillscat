import { describe, expect, it } from 'vitest';
import { buildLlmTxt } from '../src/lib/server/llm-txt';
import { getCoreSitemapPages } from '../src/lib/server/sitemap';

describe('buildLlmTxt', () => {
  it('documents the canonical machine endpoints and install guidance', () => {
    const text = buildLlmTxt();

    expect(text).toContain('CANONICAL_BASE_URL: https://skills.cat');
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
    expect(text).toContain('npx skillscat add <owner>/<repo> --skill "<skill-name>"');
    expect(text).toContain('npx skillscat info <owner>/<repo>');
    expect(text).toContain('If terminal access is available, prefer the SkillsCat CLI over manual file writes.');
    expect(text).toContain('npx skillscat add <owner>/<repo> --agent openclaw');
    expect(text).toContain('the CLI may prompt to install every indexed skill in that repo');
    expect(text).toContain('run npx skillscat login first, then re-run the add command');
  });
});

describe('getCoreSitemapPages', () => {
  it('includes llm.txt for discovery', () => {
    expect(getCoreSitemapPages().some((page) => page.url === '/llm.txt')).toBe(true);
  });
});
