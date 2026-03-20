import { describe, expect, it, vi } from 'vitest';
import { classifyByKeywords, loadSkillMdForClassification } from '../workers/classification';

describe('classifyByKeywords', () => {
  it('keeps weak secondary keyword matches out of the assigned categories', () => {
    const result = classifyByKeywords(
      `
      This skill improves SEO for websites.
      It updates sitemap files, canonical tags, metadata, and search ranking signals.
      The workflow audits SEO metadata and generates sitemap improvements for better search visibility.
      It can also review a page before publishing.
      `,
      ['seo']
    );

    expect(result.categories).toEqual(['seo']);
  });

  it('keeps strong secondary categories when evidence is comparable', () => {
    const result = classifyByKeywords(
      `
      This skill audits application security and authentication flows.
      It checks oauth login, session handling, authorization rules, and vulnerability findings.
      The workflow reviews auth configuration and security issues before release.
      `
    );

    expect(result.categories).toContain('auth');
    expect(result.categories).toContain('security');
  });
});

describe('loadSkillMdForClassification', () => {
  it('falls back to legacy GitHub cache keys when the canonical key is missing', async () => {
    const legacyKey = 'skills/Demo/Repo/.claude/SKILL.md';
    const r2Get = vi.fn(async (key: string) => {
      if (key === legacyKey) {
        return {
          async text() {
            return '# Legacy cache';
          },
        } as R2ObjectBody;
      }

      return null;
    });
    const first = vi.fn(async () => ({
      slug: 'demo-owner/demo-skill',
      source_type: 'github',
      repo_owner: 'Demo',
      repo_name: 'Repo',
      skill_path: '.claude',
      readme: '# Readme fallback',
    }));
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    const content = await loadSkillMdForClassification({
      DB: { prepare } as unknown as D1Database,
      R2: { get: r2Get } as unknown as R2Bucket,
    }, 'skill-1', 'skills/github/Demo/Repo/p:.claude/SKILL.md');

    expect(content).toBe('# Legacy cache');
    expect(first).toHaveBeenCalledTimes(1);
    expect(r2Get).toHaveBeenCalledWith(legacyKey);
  });
});
