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
  classifyWithAI,
  classifyByKeywords,
  determineClassificationMethod,
  getFreeModelCandidates,
  loadSkillMdForClassification,
  buildSkillSummaryPrompt,
  sanitizeSkillSummary,
  generateSkillSummary,
  ensureSkillSummary,
  normalizeSummaryBackfillBatchSize,
  runSummaryBackfill,
} from '../workers/classification';
import {
  getOpenRouterJsonGenerationOptions,
  getDefaultOpenRouterFreeModel,
  normalizeOpenRouterModelId,
} from '../workers/shared/ai/openrouter';

describe('classification model helpers', () => {
  it('keeps free-model candidates ordered, filtered, and deduplicated', () => {
    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'deepseek-v4-flash',
      FREE_MODELS: 'openrouter:free,deepseek/deepseek-v4-flash,vendor/paid-model',
    })).toEqual([
      'deepseek/deepseek-v4-flash',
      'openrouter/free',
    ]);

    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'vendor/paid-model',
      FREE_MODELS: 'custom/model:free,deepseek-v4-flash,openrouter:free',
    })).toEqual([
      'custom/model:free',
      'deepseek/deepseek-v4-flash',
      'openrouter/free',
    ]);
  });

  it('uses DeepSeek V4 Flash as the permanent default OpenRouter model', () => {
    expect(normalizeOpenRouterModelId('deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash');
    expect(normalizeOpenRouterModelId('deepseek/deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash');
    expect(normalizeOpenRouterModelId('openrouter:free')).toBe('openrouter/free');
    expect(getDefaultOpenRouterFreeModel()).toBe('deepseek/deepseek-v4-flash');
  });

  it('uses DeepSeek-compatible generation parameters', () => {
    expect(getOpenRouterJsonGenerationOptions('deepseek/deepseek-v4-flash', 'classification')).toEqual({
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    expect(getOpenRouterJsonGenerationOptions('deepseek/deepseek-v4-flash', 'security')).toEqual({
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    expect(getOpenRouterJsonGenerationOptions('openrouter/free', 'security')).toEqual({
      temperature: 0.2,
    });
  });

  it('respects the configured free-model order before the paid fallback', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length < 4) {
        return new Response('temporarily unavailable', { status: 503 });
      }

      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '{"categories":["automation"],"confidence":0.9,"reasoning":"Automates workflows"}',
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await classifyWithAI('This skill automates workflows.', {
        DB: {} as never,
        KV: {
          get: vi.fn(async () => null),
          put: vi.fn(async () => {}),
        } as never,
        R2: {} as never,
        OPENROUTER_API_KEY: 'or-key',
        AI_MODEL: 'openrouter/free',
        FREE_MODELS: 'deepseek/deepseek-v4-flash,openrouter/free',
        CLASSIFICATION_PAID_MODEL: 'deepseek-v4-flash',
      });

      expect(result.categories).toEqual(['automation']);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const requestBodies = fetchMock.mock.calls.map((call) => JSON.parse(
      String((call[1] as RequestInit | undefined)?.body)
    ) as { model: string; response_format?: { type: string } });
    expect(requestBodies.map((body) => body.model)).toEqual([
      'openrouter/free',
      'openrouter/free',
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-flash',
    ]);
    expect(requestBodies[0]?.response_format).toBeUndefined();
    expect(requestBodies[1]?.response_format).toBeUndefined();
    expect(requestBodies[2]?.response_format).toEqual({ type: 'json_object' });
    expect(requestBodies[3]?.response_format).toEqual({ type: 'json_object' });
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

  it('classifies practical research and information gathering workflows', () => {
    const result = classifyByKeywords(
      `
      This skill performs market research and competitive intelligence.
      It runs knowledge retrieval across sources, synthesizes findings with source attribution,
      and creates a news digest for sales intelligence and account research.
      `
    );

    expect(result.categories[0]).toBe('research');
    expect(result.categories).not.toContain('academic');
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
      AI_MODEL: 'deepseek-v4-flash',
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
      model: 'deepseek/deepseek-v4-flash',
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
      AI_MODEL: 'deepseek-v4-flash',
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
      AI_MODEL: 'deepseek-v4-flash',
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
    const originalFetch = globalThis.fetch;
    const indexNowFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const waitUntilTasks: Promise<unknown>[] = [];
    vi.stubGlobal('fetch', indexNowFetch);
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
      INDEXNOW_KEY: 'secret-key',
    } as never;

    try {
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
      } as never, env, {
        waitUntil(promise: Promise<unknown>) {
          waitUntilTasks.push(promise);
        },
      } as never);
      await Promise.all(waitUntilTasks);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ['succeeded', 'openrouter/free', 'deepseek/deepseek-v4-flash'],
      doubles: [2, 2, 0, 0, 1, 0, 1],
      indexes: ['classification-batch'],
    });
    expect(indexNowFetch).toHaveBeenCalledTimes(1);
    const indexNowBody = JSON.parse(String(indexNowFetch.mock.calls[0]?.[1]?.body)) as {
      urlList: string[];
    };
    expect(indexNowBody.urlList).toContain('https://skills.cat/category/automation');
    expect(new Set(indexNowBody.urlList).size).toBe(indexNowBody.urlList.length);
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

describe('skill summary generation', () => {
  it('builds a prompt with the description, a capped excerpt, and anti-marketing rules', () => {
    const longContent = `header ${'x'.repeat(5000)}`;
    const prompt = buildSkillSummaryPrompt(longContent, 'Automates git chores');

    expect(prompt).toContain('Author-provided short description: Automates git chores');
    expect(prompt).toContain('no marketing language');
    expect(prompt).toContain('no keyword stuffing');
    expect(prompt).toContain('2-3 sentence');
    // Excerpt is capped well below the raw content length.
    expect(prompt.length).toBeLessThan(longContent.length);
    expect(prompt).not.toContain('x'.repeat(2500));
  });

  it('omits the description line when no description is available', () => {
    const prompt = buildSkillSummaryPrompt('SKILL.md body');
    expect(prompt).not.toContain('Author-provided short description');
    expect(prompt).toContain('SKILL.md body');
  });

  it('sanitizes model output into a single-line summary', () => {
    expect(
      sanitizeSkillSummary('  "This skill reviews pull requests.\nIt posts inline comments."  ')
    ).toBe('This skill reviews pull requests. It posts inline comments.');

    // Too short to be a real summary.
    expect(sanitizeSkillSummary('ok')).toBeNull();
    expect(sanitizeSkillSummary('')).toBeNull();
    expect(sanitizeSkillSummary(null)).toBeNull();

    // Overlong output is cut at the last sentence boundary within the cap.
    const long = `${'a'.repeat(400)}. ${'b'.repeat(400)}.`;
    const sanitized = sanitizeSkillSummary(long);
    expect(sanitized).toBe(`${'a'.repeat(400)}.`);
  });

  it('returns null without an OpenRouter API key and never calls fetch', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      const summary = await generateSkillSummary('SKILL.md body', null, {
        DB: {} as never,
        KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as never,
        R2: {} as never,
      });
      expect(summary).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('generates a summary with the free model first', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: 'This skill automates git commit messages. It helps developers write consistent history.',
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const summary = await generateSkillSummary('SKILL.md body about git commits', 'Git helper', {
        DB: {} as never,
        KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as never,
        R2: {} as never,
        OPENROUTER_API_KEY: 'or-key',
      });

      expect(summary).toBe(
        'This skill automates git commit messages. It helps developers write consistent history.'
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        model: string;
        max_tokens: number;
        response_format?: unknown;
        messages: Array<{ content: string }>;
      };
      expect(requestBody.model).toBe('deepseek/deepseek-v4-flash');
      expect(requestBody.response_format).toBeUndefined();
      expect(requestBody.messages[0]?.content).toContain('Git helper');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('falls back to the paid model when all free models fail', async () => {
    const originalFetch = globalThis.fetch;
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call <= 2) {
        return new Response('unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'This skill lints markdown files for consistent style.' } }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const summary = await generateSkillSummary('SKILL.md body', null, {
        DB: {} as never,
        KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as never,
        R2: {} as never,
        OPENROUTER_API_KEY: 'or-key',
      });

      expect(summary).toBe('This skill lints markdown files for consistent style.');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const lastBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { model: string };
      expect(lastBody.model).toBe('deepseek/deepseek-v4-flash');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('skips skills that already have a summary', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const updates: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('SELECT summary, description FROM skills')) {
            return {
              bind: () => ({
                first: async () => ({ summary: 'Existing summary.', description: 'desc' }),
              }),
            };
          }
          if (sql.includes('UPDATE skills SET summary')) {
            return {
              bind: (...args: unknown[]) => {
                updates.push(String(args[0]));
                return { run: async () => ({ success: true }) };
              },
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
      R2: { get: vi.fn(async () => null) },
      OPENROUTER_API_KEY: 'or-key',
    } as never;

    try {
      const summary = await ensureSkillSummary(env, {
        skillId: 'skill-1',
        skillSlug: 'owner/skill-1',
        skillMdContent: 'SKILL.md body',
      });

      expect(summary).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(updates).toEqual([]);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('writes a generated summary back and invalidates skill caches', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: 'This skill audits dependencies for known vulnerabilities. Use it before releases.',
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const updates: Array<{ summary: string; id: string }> = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('SELECT summary, description FROM skills')) {
            return {
              bind: () => ({
                first: async () => ({ summary: null, description: 'Dependency auditor' }),
              }),
            };
          }
          if (sql.includes('UPDATE skills SET summary')) {
            expect(sql).not.toContain('updated_at');
            return {
              bind: (summary: string, id: string) => ({
                run: async () => {
                  updates.push({ summary, id });
                  return { success: true };
                },
              }),
            };
          }
          if (sql.includes('SELECT slug FROM skills')) {
            return {
              bind: () => ({
                first: async () => ({ slug: 'owner/skill-2' }),
              }),
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
      R2: { get: vi.fn(async () => null) },
      OPENROUTER_API_KEY: 'or-key',
    } as never;

    try {
      const summary = await ensureSkillSummary(env, {
        skillId: 'skill-2',
        skillSlug: 'owner/skill-2',
        skillMdContent: 'SKILL.md body about dependency auditing',
      });

      expect(summary).toBe(
        'This skill audits dependencies for known vulnerabilities. Use it before releases.'
      );
      expect(updates).toEqual([{
        summary: 'This skill audits dependencies for known vulnerabilities. Use it before releases.',
        id: 'skill-2',
      }]);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('does not write anything when summary generation fails', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const updates: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('SELECT summary, description FROM skills')) {
            return {
              bind: () => ({
                first: async () => ({ summary: null, description: null }),
              }),
            };
          }
          if (sql.includes('UPDATE skills SET summary')) {
            return {
              bind: (...args: unknown[]) => {
                updates.push(String(args[0]));
                return { run: async () => ({ success: true }) };
              },
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
      R2: { get: vi.fn(async () => null) },
      OPENROUTER_API_KEY: 'or-key',
    } as never;

    try {
      const summary = await ensureSkillSummary(env, {
        skillId: 'skill-3',
        skillSlug: 'owner/skill-3',
        skillMdContent: 'SKILL.md body',
      });

      expect(summary).toBeNull();
      expect(updates).toEqual([]);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });
});

describe('summary backfill cron', () => {
  it('normalizes the batch size with a default and an upper cap', () => {
    expect(normalizeSummaryBackfillBatchSize(undefined)).toBe(40);
    expect(normalizeSummaryBackfillBatchSize('')).toBe(40);
    expect(normalizeSummaryBackfillBatchSize('abc')).toBe(40);
    expect(normalizeSummaryBackfillBatchSize('-5')).toBe(40);
    expect(normalizeSummaryBackfillBatchSize('10')).toBe(10);
    expect(normalizeSummaryBackfillBatchSize('9999')).toBe(200);
  });

  function createBackfillEnv(options: {
    candidates: Array<{
      rowid: number;
      id: string;
      slug: string;
      source_type: string;
      repo_owner: string | null;
      repo_name: string | null;
      skill_path: string | null;
      readme: string | null;
      tier: string | null;
    }>;
    storedCursor?: string | null;
  }) {
    const updates: Array<{ summary: string; id: string }> = [];
    const kvStore = new Map<string, string>();
    if (options.storedCursor != null) {
      kvStore.set('summary-backfill:cursor', options.storedCursor);
    }

    const env = {
      DB: {
        prepare: (sql: string) => {
          if (sql.includes('SELECT rowid, id, slug')) {
            expect(sql).toContain("visibility = 'public'");
            expect(sql).toContain("COALESCE(tier, 'cold') <> 'archived'");
            expect(sql).toContain('summary IS NULL');
            return {
              bind: (cursor: number, batchSize: number) => ({
                all: async () => ({
                  results: options.candidates
                    .filter((row) => row.rowid > cursor)
                    .slice(0, batchSize),
                }),
              }),
            };
          }
          if (sql.includes('SELECT summary, description FROM skills')) {
            return {
              bind: () => ({
                first: async () => ({ summary: null, description: 'desc' }),
              }),
            };
          }
          if (sql.includes('UPDATE skills SET summary')) {
            return {
              bind: (summary: string, id: string) => ({
                run: async () => {
                  updates.push({ summary, id });
                  return { success: true };
                },
              }),
            };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      },
      KV: {
        get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          kvStore.set(key, value);
        }),
      },
      R2: { get: vi.fn(async () => null) },
      OPENROUTER_API_KEY: 'or-key',
    } as never;

    return { env, updates, kvStore };
  }

  it('processes candidates after the cursor and advances it', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: 'This skill audits dependencies for known vulnerabilities.',
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { env, updates, kvStore } = createBackfillEnv({
      storedCursor: '10',
      candidates: [
        {
          rowid: 5,
          id: 'skill-old',
          slug: 'acme/old',
          source_type: 'github',
          repo_owner: 'acme',
          repo_name: 'old',
          skill_path: null,
          readme: 'SKILL.md body',
          tier: 'cold',
        },
        {
          rowid: 11,
          id: 'skill-a',
          slug: 'acme/a',
          source_type: 'github',
          repo_owner: 'acme',
          repo_name: 'a',
          skill_path: null,
          readme: 'SKILL.md body A',
          tier: 'warm',
        },
        {
          rowid: 12,
          id: 'skill-b',
          slug: 'acme/b',
          source_type: 'upload',
          repo_owner: null,
          repo_name: null,
          skill_path: null,
          readme: 'SKILL.md body B',
          tier: null,
        },
      ],
    });

    try {
      const stats = await runSummaryBackfill(env);

      // The rowid=5 row is behind the cursor and must be skipped.
      expect(stats.processed).toBe(2);
      expect(stats.generated).toBe(2);
      expect(updates.map((entry) => entry.id)).toEqual(['skill-a', 'skill-b']);
      expect(kvStore.get('summary-backfill:cursor')).toBe('12');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('wraps the cursor around and stops when no candidates remain', async () => {
    const { env, kvStore } = createBackfillEnv({
      storedCursor: '99',
      candidates: [],
    });

    const stats = await runSummaryBackfill(env);

    expect(stats).toEqual({ processed: 0, generated: 0, cursor: 0 });
    expect(kvStore.get('summary-backfill:cursor')).toBe('0');
  });

  it('does not touch the cursor when the table is empty from the start', async () => {
    const { env, kvStore } = createBackfillEnv({ candidates: [] });

    const stats = await runSummaryBackfill(env);

    expect(stats).toEqual({ processed: 0, generated: 0, cursor: 0 });
    expect(kvStore.has('summary-backfill:cursor')).toBe(false);
  });
});
