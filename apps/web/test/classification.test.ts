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

import classificationWorker, {
  classifyByKeywords,
  determineClassificationMethod,
  getFreeModelCandidates,
  loadSkillMdForClassification,
} from '../workers/classification';

describe('classification model helpers', () => {
  it('keeps free-model candidates ordered, filtered, and deduplicated', () => {
    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'minimax/minimax-m2.5:free',
      FREE_MODELS: 'openrouter/free,minimax/minimax-m2.5:free,openai/gpt-5.4-nano',
    })).toEqual([
      'minimax/minimax-m2.5:free',
      'openrouter/free',
    ]);

    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'openai/gpt-5.4-nano',
      FREE_MODELS: 'minimax/minimax-m2.5:free,openrouter/free',
    })).toEqual([
      'minimax/minimax-m2.5:free',
      'openrouter/free',
    ]);
  });

  it('uses AI classification only for hot-worthy skills', () => {
    expect(determineClassificationMethod(3, 'hot')).toBe('ai');
    expect(determineClassificationMethod(1200, null)).toBe('ai');
    expect(determineClassificationMethod(999, null)).toBe('keyword');
    expect(determineClassificationMethod(3, 'warm')).toBe('keyword');
  });
});

describe('classifyByKeywords', () => {
  it('prefers design over embeddings for UI/UX direction skills', () => {
    const result = classifyByKeywords(
      `
      This skill reviews UI/UX direction for product teams.
      It critiques layout, typography, spacing, color palette, user flow, and Figma prototypes.
      It can also suggest semantic HTML improvements and better search results UX.
      `
    );

    expect(result.categories[0]).toBe('design');
    expect(result.categories).not.toContain('embeddings');
  });

  it('prefers design over ui-components for design-direction frontend skills', () => {
    const result = classifyByKeywords(
      `
      This skill creates distinctive frontend interfaces with strong UI/UX direction.
      It focuses on visual design, typography, brand identity, color palettes, design systems,
      mockups, art direction, and interface critique before generating React and HTML/CSS components.
      `
    );

    expect(result.categories[0]).toBe('design');
    expect(result.categories).not.toContain('productivity');
  });

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
  it('uses AI classification for hot-worthy repos when a free OpenRouter model is configured', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"categories":["code-review"],"confidence":0.92,"reasoning":"Reviews PRs and code quality"}',
        },
      }],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const updatedMethods: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('FROM skills') && sql.includes('WHERE id IN')) {
            return {
              bind: (...args: unknown[]) => {
                expect(args).toEqual(['skill-ai']);
                return {
                  all: async () => ({
                    results: [{
                      id: 'skill-ai',
                      slug: 'owner/skill-ai',
                      source_type: 'github',
                      repo_owner: 'owner',
                      repo_name: 'repo',
                      skill_path: null,
                      readme: null,
                      tier: 'hot',
                    }],
                  }),
                };
              },
            };
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
              bind: (method: string) => ({
                run: async () => {
                  updatedMethods.push(method);
                  return { success: true };
                },
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
                return 'This skill reviews pull requests, writes review comments, and audits code quality.';
              },
            } as R2ObjectBody;
          }

          return null;
        }),
      },
      OPENROUTER_API_KEY: 'or-key',
      AI_MODEL: 'minimax/minimax-m2.5:free',
      CLASSIFICATION_PAID_MODEL: 'openai/gpt-5.4-nano',
    } as never;

    try {
      await classificationWorker.queue({
        messages: [{
          id: 'msg-ai',
          body: {
            type: 'classify',
            skillId: 'skill-ai',
            repoOwner: 'owner',
            repoName: 'repo',
            skillMdPath: 'skills/github/owner/repo/SKILL.md',
            stars: 1200,
          },
          ack: vi.fn(),
          retry: vi.fn(),
        }],
      } as never, env, {} as never);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updatedMethods).toEqual(['ai']);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(requestBody).toMatchObject({
      model: 'minimax/minimax-m2.5:free',
    });
    expect(requestBody.messages[0]?.content).toContain('Use design for UI/UX direction');
    expect(requestBody.messages[0]?.content).toContain('Use embeddings only for real vector retrieval');
  });

  it('folds AI-suggested design variants back into the canonical design category', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            categories: ['ui-components', 'code-generation'],
            confidence: 0.91,
            reasoning: 'Design-heavy frontend skill',
            suggestedCategory: {
              slug: 'creative-design',
              name: 'Creative Design',
              description: 'Creative direction and visual styling for interfaces',
            },
          }),
        },
      }],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const insertedCategories: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('FROM skills') && sql.includes('WHERE id IN')) {
            return {
              bind: (...args: unknown[]) => {
                expect(args).toEqual(['skill-ai-alias']);
                return {
                  all: async () => ({
                    results: [{
                      id: 'skill-ai-alias',
                      slug: 'owner/skill-ai-alias',
                      source_type: 'github',
                      repo_owner: 'owner',
                      repo_name: 'repo',
                      skill_path: null,
                      readme: null,
                      tier: 'hot',
                    }],
                  }),
                };
              },
            };
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
              bind: (_skillId: string, categorySlug: string) => ({
                run: async () => {
                  insertedCategories.push(categorySlug);
                  return { success: true };
                },
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
                return 'This skill defines creative frontend direction, typography, branding, and visual design while generating components.';
              },
            } as R2ObjectBody;
          }

          return null;
        }),
      },
      OPENROUTER_API_KEY: 'or-key',
      AI_MODEL: 'minimax/minimax-m2.5:free',
      CLASSIFICATION_PAID_MODEL: 'openai/gpt-5.4-nano',
    } as never;

    try {
      await classificationWorker.queue({
        messages: [{
          id: 'msg-ai-alias',
          body: {
            type: 'classify',
            skillId: 'skill-ai-alias',
            repoOwner: 'owner',
            repoName: 'repo',
            skillMdPath: 'skills/github/owner/repo/SKILL.md',
            stars: 1200,
          },
          ack: vi.fn(),
          retry: vi.fn(),
        }],
      } as never, env, {} as never);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(insertedCategories).toEqual(['ui-components', 'design', 'code-generation']);
  });

  it('keeps low-priority repos on keyword classification even when free OpenRouter models are available', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const updatedMethods: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('FROM skills') && sql.includes('WHERE id IN')) {
            return {
              bind: (...args: unknown[]) => {
                expect(args).toEqual(['skill-keyword-free']);
                return {
                  all: async () => ({
                    results: [{
                      id: 'skill-keyword-free',
                      slug: 'owner/skill-keyword-free',
                      source_type: 'github',
                      repo_owner: 'owner',
                      repo_name: 'repo',
                      skill_path: null,
                      readme: null,
                      tier: 'cold',
                    }],
                  }),
                };
              },
            };
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
              bind: (method: string) => ({
                run: async () => {
                  updatedMethods.push(method);
                  return { success: true };
                },
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
                return 'This skill reviews pull requests, writes review comments, and audits code quality.';
              },
            } as R2ObjectBody;
          }

          return null;
        }),
      },
      OPENROUTER_API_KEY: 'or-key',
      AI_MODEL: 'minimax/minimax-m2.5:free',
      CLASSIFICATION_PAID_MODEL: 'openai/gpt-5.4-nano',
    } as never;

    try {
      await classificationWorker.queue({
        messages: [{
          id: 'msg-keyword-free',
          body: {
            type: 'classify',
            skillId: 'skill-keyword-free',
            repoOwner: 'owner',
            repoName: 'repo',
            skillMdPath: 'skills/github/owner/repo/SKILL.md',
            stars: 3,
          },
          ack: vi.fn(),
          retry: vi.fn(),
        }],
      } as never, env, {} as never);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updatedMethods).toEqual(['keyword']);
  });

  it('writes one analytics datapoint per processed batch', async () => {
    const writeDataPoint = vi.fn();
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('FROM skills') && sql.includes('WHERE id IN')) {
            return {
              bind: (...args: unknown[]) => {
                expect(args).toEqual(['skill-keyword']);
                return {
                  all: async () => ({
                    results: [{
                      id: 'skill-keyword',
                      slug: 'owner/skill-keyword',
                      source_type: 'github',
                      repo_owner: 'owner',
                      repo_name: 'repo',
                      skill_path: null,
                      readme: null,
                    }],
                  }),
                };
              },
            };
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
      CLASSIFICATION_ANALYTICS: {
        writeDataPoint,
      },
      AI_MODEL: 'openrouter/free',
      CLASSIFICATION_PAID_MODEL: 'openai/gpt-5.4-nano',
    } as never;

    await classificationWorker.queue({
      messages: [
        {
          id: 'msg-direct',
          body: {
            type: 'classify',
            skillId: 'skill-direct',
            repoOwner: 'owner',
            repoName: 'repo',
            skillMdPath: 'skills/github/owner/repo/SKILL.md',
            frontmatterCategories: ['automation'],
          },
          ack: vi.fn(),
          retry: vi.fn(),
        },
        {
          id: 'msg-keyword',
          body: {
            type: 'classify',
            skillId: 'skill-keyword',
            repoOwner: 'owner',
            repoName: 'repo',
            skillMdPath: 'skills/github/owner/repo/SKILL.md',
          },
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
    } as never, env, {} as never);

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ['succeeded', 'openrouter/free', 'openai/gpt-5.4-nano'],
      doubles: [2, 2, 0, 0, 1, 0, 1],
      indexes: ['classification-batch'],
    });
  });

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

  it('treats canonicalized frontmatter aliases as direct category matches', async () => {
    const insertedCategories: string[] = [];
    const updatedMethods: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
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
              bind: (_skillId: string, categorySlug: string) => ({
                run: async () => {
                  insertedCategories.push(categorySlug);
                  return { success: true };
                },
              }),
            };
          }

          if (sql === 'UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?') {
            return {
              bind: (method: string) => ({
                run: async () => {
                  updatedMethods.push(method);
                  return { success: true };
                },
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

    await classificationWorker.queue({
      messages: [{
        id: 'msg-direct-alias',
        body: {
          type: 'classify',
          skillId: 'skill-direct-alias',
          repoOwner: 'owner',
          repoName: 'repo',
          skillMdPath: 'skills/github/owner/repo/SKILL.md',
          frontmatterCategories: ['UI/UX', 'design-systems', 'responsive-design'],
        },
        ack: vi.fn(),
        retry: vi.fn(),
      }],
    } as never, env, {} as never);

    expect(updatedMethods).toEqual(['direct']);
    expect(insertedCategories).toEqual(['design', 'responsive']);
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
