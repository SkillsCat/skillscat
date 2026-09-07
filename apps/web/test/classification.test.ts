import { createMigratedDb, createMemoryKv } from './helpers/migrated-db';
import { persistSkillLocalizations } from '../src/lib/server/seo/localizations';
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
  getOpenRouterProviderRouting,
  normalizeOpenRouterModelId,
} from '../workers/shared/ai/openrouter';

describe('classification model helpers', () => {
  it('keeps explicitly configured model candidates ordered and deduplicated', () => {
    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'deepseek-v4-flash',
      FREE_MODELS: 'openrouter:free,deepseek/deepseek-v4-flash,vendor/paid-model',
    })).toEqual([
      'deepseek/deepseek-v4-flash-0731',
      'openrouter/free',
      'deepseek/deepseek-v4-flash',
      'vendor/paid-model',
    ]);

    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'vendor/paid-model',
      FREE_MODELS: 'custom/model:free,deepseek-v4-flash,openrouter:free',
    })).toEqual([
      'vendor/paid-model',
      'custom/model:free',
      'deepseek/deepseek-v4-flash-0731',
      'openrouter/free',
    ]);
  });

  it('keeps an explicitly configured model without falling back to defaults', () => {
    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
      AI_MODEL: 'deepseek-ai/DeepSeek-V4-Flash',
      FREE_MODELS: '',
    })).toEqual([
      'deepseek-ai/DeepSeek-V4-Flash',
    ]);
  });

  it('falls back to the default free models only when nothing is configured', () => {
    expect(getFreeModelCandidates({
      DB: {} as never,
      KV: {} as never,
      R2: {} as never,
    })).toEqual([
      'deepseek/deepseek-v4-flash-0731',
      'openrouter/free',
    ]);
  });

  it('uses DeepSeek V4 Flash 0731 as the permanent default OpenRouter model', () => {
    expect(normalizeOpenRouterModelId('deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash-0731');
    expect(normalizeOpenRouterModelId('deepseek/deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash');
    expect(normalizeOpenRouterModelId('openrouter:free')).toBe('openrouter/free');
    expect(getDefaultOpenRouterFreeModel()).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('uses DeepSeek-compatible generation parameters', () => {
    expect(getOpenRouterJsonGenerationOptions('deepseek/deepseek-v4-flash-0731', 'classification')).toEqual({
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    expect(getOpenRouterJsonGenerationOptions('deepseek/deepseek-v4-flash-0731', 'security')).toEqual({
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    expect(getOpenRouterJsonGenerationOptions('deepseek/deepseek-v4-flash', 'classification')).toEqual({
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });
    expect(getOpenRouterJsonGenerationOptions('openrouter/free', 'security')).toEqual({
      temperature: 0.2,
    });
  });

  it('routes DeepSeek V4 Flash models to GMICloud and leaves the free pool unrouted', () => {
    const gmiRouting = {
      provider: { order: ['GMICloud'], allow_fallbacks: true },
    };
    expect(getOpenRouterProviderRouting('deepseek/deepseek-v4-flash-0731')).toEqual(gmiRouting);
    expect(getOpenRouterProviderRouting('deepseek/deepseek-v4-flash')).toEqual(gmiRouting);
    expect(getOpenRouterProviderRouting('deepseek-v4-flash')).toEqual(gmiRouting);
    expect(getOpenRouterProviderRouting('openrouter/free')).toEqual({});
    expect(getOpenRouterProviderRouting('vendor/paid-model')).toEqual({});
  });

  it('respects the configured free-model order before the paid fallback', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length < 3) {
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requestBodies = fetchMock.mock.calls.map((call) => JSON.parse(
      String((call[1] as RequestInit | undefined)?.body)
    ) as {
      model: string;
      response_format?: { type: string };
      provider?: { order: string[]; allow_fallbacks: boolean };
    });
    expect(requestBodies.map((body) => body.model)).toEqual([
      'openrouter/free',
      'openrouter/free',
      'deepseek/deepseek-v4-flash-0731',
    ]);
    expect(requestBodies[0]?.response_format).toBeUndefined();
    expect(requestBodies[1]?.response_format).toBeUndefined();
    expect(requestBodies[2]?.response_format).toEqual({ type: 'json_object' });
    // The free pool is never routed; DeepSeek V4 Flash is pinned to GMICloud.
    expect(requestBodies[0]?.provider).toBeUndefined();
    expect(requestBodies[1]?.provider).toBeUndefined();
    expect(requestBodies[2]?.provider).toEqual({ order: ['GMICloud'], allow_fallbacks: true });
  });

  it('targets the OpenRouter endpoint with attribution headers and GMICloud routing for the default model', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"categories":["automation"],"confidence":0.9,"reasoning":"Automates workflows"}',
        },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
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
        AI_MODEL: 'deepseek/deepseek-v4-flash-0731',
      });

      expect(result.categories).toEqual(['automation']);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer or-key');
    expect(headers['HTTP-Referer']).toBe('https://skills.cat');
    expect(headers['X-Title']).toBe('SkillsCat Classification Worker');

    const requestBody = JSON.parse(String(init.body)) as {
      model: string;
      response_format?: { type: string };
      provider?: { order: string[]; allow_fallbacks: boolean };
    };
    expect(requestBody.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
    expect(requestBody.provider).toEqual({ order: ['GMICloud'], allow_fallbacks: true });
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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
      model: 'deepseek/deepseek-v4-flash-0731',
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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
      blobs: ['succeeded', 'openrouter/free', 'deepseek/deepseek-v4-flash-0731'],
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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
          if (sql.includes('AS sourceHash FROM skills')) return { bind: () => ({ first: async () => ({ sourceHash: 'test-hash' }) }) };
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

describe('validated bilingual introduction generation', () => {
  const en = 'This skill audits dependencies for known vulnerabilities. Use it before releases.';
  const zh = '检查项目依赖中的已知漏洞，帮助了解依赖风险。适用于准备版本发布或核查项目依赖的场景。';
  function setup() {
    const { db, sqlite, queries } = createMigratedDb();
    const { kv, values } = createMemoryKv();
    const now = Date.now();
    sqlite.prepare(`INSERT INTO skills (id, name, slug, description, readme, content_hash, indexed_at, created_at)
      VALUES ('skill-1', 'Audit', 'owner/audit', 'Dependency auditor', '# Audit dependencies', 'hash1', ?, ?)`)
      .run(now, now);
    return { db, sqlite, queries, values, env: { DB: db, KV: kv, R2: { get: async () => null }, OPENROUTER_API_KEY: 'test', AI_MODEL: 'openrouter/free' } as never };
  }
  it('caps input and asks for grounded bilingual JSON', () => {
    const prompt = buildSkillSummaryPrompt('header ' + 'x'.repeat(5000), 'Automates git chores');
    expect(prompt).toContain('Author-provided short description: Automates git chores');
    expect(prompt).toContain('no marketing language');
    expect(prompt).toContain('zh-CN');
    expect(prompt).not.toContain('x'.repeat(2500));
    expect(buildSkillSummaryPrompt('source')).not.toContain('Author-provided short description');
  });
  it('rejects unfinished, analysis and overlong output', () => {
    expect(sanitizeSkillSummary('  "This skill reviews pull requests. It posts inline comments."  ')).toBe('This skill reviews pull requests. It posts inline comments.');
    for (const value of [null, '', 'ok', 'a'.repeat(700), 'The user wants a summary. Let me analyze the skill.']) expect(sanitizeSkillSummary(value)).toBeNull();
  });
  it('makes no model request without a key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await generateSkillSummary('source', null, {} as never)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it('stores both languages atomically and reuses a valid content version', async () => {
    const { env, db, sqlite } = setup();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ en, 'zh-CN': zh }) } }] })));
    try {
      expect(await ensureSkillSummary(env, { skillId: 'skill-1', skillSlug: 'owner/audit', skillMdContent: 'source' })).toBe(en);
      expect(sqlite.prepare('SELECT summary FROM skills').get()).toMatchObject({ summary: en });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM skill_localizations').get()).toMatchObject({ count: 2 });
      await ensureSkillSummary(env, { skillId: 'skill-1', skillMdContent: 'source' });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(await persistSkillLocalizations(db, 'skill-1', 'hash1', { en, 'zh-CN': zh })).toBe(false);
    } finally { fetch.mockRestore(); sqlite.close(); }
  });
  it('leaves valid source text untouched and backs off on model failure', async () => {
    const { env, sqlite } = setup();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
    try {
      expect(await ensureSkillSummary(env, { skillId: 'skill-1', skillMdContent: 'source' })).toBeNull();
      expect(sqlite.prepare('SELECT description, summary FROM skills').get()).toMatchObject({ description: 'Dependency auditor', summary: null });
      expect(sqlite.prepare('SELECT next_attempt_at FROM skill_localizations').get()?.next_attempt_at).toBeGreaterThan(Date.now());
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fetch.mockRestore(); sqlite.close(); }
  });
  it('honors configured repair batch bounds', () => {
    expect(normalizeSummaryBackfillBatchSize(undefined)).toBe(40);
    expect(normalizeSummaryBackfillBatchSize('10')).toBe(10);
    expect(normalizeSummaryBackfillBatchSize('9999')).toBe(200);
  });
  it('advances the bounded repair cursor and does not regenerate completed rows', async () => {
    const { env, sqlite, values } = setup();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ en, 'zh-CN': zh }) } }] })));
    try {
      const result = await runSummaryBackfill(env);
      expect(result.generated).toBe(1);
      expect(values.get('summary-backfill:cursor:v2')).toBe('1');
      await runSummaryBackfill(env);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fetch.mockRestore(); sqlite.close(); }
  });
});
