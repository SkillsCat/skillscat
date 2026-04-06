import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/server/cache/categories', () => ({
  invalidateCategoryCaches: vi.fn(async () => {}),
}));

vi.mock('../src/lib/server/db/business/stats', () => ({
  syncCategoryPublicStats: vi.fn(async () => {}),
}));

vi.mock('../src/lib/server/ranking/recommend-precompute', () => ({
  markRecommendDirty: vi.fn(async () => {}),
}));

vi.mock('../src/lib/server/ranking/search-precompute', () => ({
  markSearchDirty: vi.fn(async () => {}),
}));

import classificationWorker, { classifyByKeywords, loadSkillMdForClassification } from '../workers/classification';

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

  it('uses preloaded storage metadata to avoid a fallback DB lookup', async () => {
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
    const prepare = vi.fn();

    const content = await loadSkillMdForClassification({
      DB: { prepare } as unknown as D1Database,
      R2: { get: r2Get } as unknown as R2Bucket,
    }, 'skill-1', 'skills/github/Demo/Repo/p:.claude/SKILL.md', {
      slug: 'demo-owner/demo-skill',
      source_type: 'github',
      repo_owner: 'Demo',
      repo_name: 'Repo',
      skill_path: '.claude',
      readme: '# Readme fallback',
    });

    expect(content).toBe('# Legacy cache');
    expect(prepare).not.toHaveBeenCalled();
    expect(r2Get).toHaveBeenCalledWith(legacyKey);
  });
});

describe('classification queue preloading', () => {
  it('skips storage preload for direct frontmatter matches', async () => {
    const sqls: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          sqls.push(sql);

          if (sql === 'SELECT category_slug FROM skill_categories WHERE skill_id = ?') {
            return {
              bind: () => ({
                all: async () => ({ results: [] }),
              }),
            };
          }

          if (sql === 'DELETE FROM skill_categories WHERE skill_id = ?') {
            return {
              bind: () => ({
                run: async () => ({ success: true }),
              }),
            };
          }

          if (sql.includes('INSERT OR IGNORE INTO skill_categories')) {
            return {
              bind: () => ({
                run: async () => ({ success: true }),
              }),
            };
          }

          if (sql === 'UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?') {
            return {
              bind: () => ({
                run: async () => ({ success: true }),
              }),
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
      },
      R2: { get: vi.fn(async () => null) },
    } as never;

    let acked = 0;
    let retried = 0;
    await classificationWorker.queue({
      messages: [{
        id: 'msg-direct',
        body: {
          type: 'classify',
          skillId: 'skill-direct',
          repoOwner: 'owner',
          repoName: 'repo',
          skillMdPath: 'skills/github/owner/repo/SKILL.md',
          frontmatterCategories: ['automation'],
        },
        ack: () => {
          acked += 1;
        },
        retry: () => {
          retried += 1;
        },
      }],
    } as never, env, {} as never);

    expect(acked).toBe(1);
    expect(retried).toBe(0);
    expect(sqls.some((sql) => sql.includes('FROM skills') && sql.includes('WHERE id IN'))).toBe(false);
  });

  it('falls back to per-message processing when preload fails', async () => {
    const sqls: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          sqls.push(sql);

          if (sql.includes('FROM skills') && sql.includes('WHERE id IN')) {
            throw new Error('preload failed');
          }

          if (sql === 'SELECT category_slug FROM skill_categories WHERE skill_id = ?') {
            return {
              bind: () => ({
                all: async () => ({ results: [] }),
              }),
            };
          }

          if (sql === 'DELETE FROM skill_categories WHERE skill_id = ?') {
            return {
              bind: () => ({
                run: async () => ({ success: true }),
              }),
            };
          }

          if (sql.includes('INSERT OR IGNORE INTO skill_categories')) {
            return {
              bind: () => ({
                run: async () => ({ success: true }),
              }),
            };
          }

          if (sql === 'UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?') {
            return {
              bind: () => ({
                run: async () => ({ success: true }),
              }),
            };
          }

          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
      },
      R2: {
        get: vi.fn(async (key: string) => {
          if (key === 'skills/github/owner/repo/SKILL.md') {
            return {
              async text() {
                return 'This skill automates git workflows and repository maintenance.';
              },
            } as R2ObjectBody;
          }

          return null;
        }),
      },
    } as never;

    let acked = 0;
    let retried = 0;
    await classificationWorker.queue({
      messages: [{
        id: 'msg-fallback',
        body: {
          type: 'classify',
          skillId: 'skill-fallback',
          repoOwner: 'owner',
          repoName: 'repo',
          skillMdPath: 'skills/github/owner/repo/SKILL.md',
        },
        ack: () => {
          acked += 1;
        },
        retry: () => {
          retried += 1;
        },
      }],
    } as never, env, {} as never);

    expect(acked).toBe(1);
    expect(retried).toBe(0);
    expect(sqls.some((sql) => sql.includes('FROM skills') && sql.includes('WHERE id IN'))).toBe(true);
  });
});
