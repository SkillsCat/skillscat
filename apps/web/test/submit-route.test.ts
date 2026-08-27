import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRateLimitKvKey } from '../src/lib/server/github-client/rate-limit-kv';
import { getGitHubTokenId } from '../src/lib/server/github-client/token-pool';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

class MemoryRateLimitKv {
  readonly store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

interface MockExistingSkill {
  id?: string;
  slug: string;
  tier: string;
  nextUpdateAt?: number | null;
  indexedAt?: number | null;
}

function buildDbMock(existingByPath: Record<string, MockExistingSkill> = {}) {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes("COALESCE(skill_path, '') IN (")) {
        return {
          bind: (_owner: string, _repo: string, ...skillPaths: string[]) => ({
            all: vi.fn(async () => ({
              results: skillPaths.flatMap((skillPath) => {
                const existing = existingByPath[skillPath];
                if (!existing) return [];
                return [{
                  id: existing.id ?? 'skill_existing',
                  slug: existing.slug,
                  tier: existing.tier,
                  next_update_at: existing.nextUpdateAt ?? null,
                  indexed_at: existing.indexedAt ?? null,
                  normalizedSkillPath: skillPath,
                }];
              }),
            })),
          }),
        };
      }

      if (sql.includes('SELECT id, slug, tier')) {
        return {
          bind: (_owner: string, _repo: string, skillPath: string) => ({
            first: vi.fn(async () => {
              const existing = existingByPath[skillPath];
              if (!existing) return null;
              return {
                id: existing.id ?? 'skill_existing',
                slug: existing.slug,
                tier: existing.tier,
                next_update_at: existing.nextUpdateAt ?? null,
                indexed_at: existing.indexedAt ?? null,
              };
            }),
          }),
        };
      }

      if (sql.includes('SELECT slug, tier')) {
        return {
          bind: (_owner: string, _repo: string, skillPath: string) => ({
            first: vi.fn(async () => {
              const existing = existingByPath[skillPath];
              if (!existing) return null;
              return {
                slug: existing.slug,
                tier: existing.tier,
                next_update_at: existing.nextUpdateAt ?? null,
                indexed_at: existing.indexedAt ?? null,
              };
            }),
          }),
        };
      }

      if (sql.includes('INSERT INTO user_actions')) {
        return {
          bind: () => ({
            run: vi.fn(async () => ({})),
          }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('../src/lib/server/github-client/request');
  vi.doUnmock('../src/lib/server/auth/middleware');
  vi.doUnmock('../src/lib/server/skill/resurrection');
});

describe('submit route', () => {
  it('accepts an organization token with publish scope for repository submission', async () => {
    const requireSubmitPublishScope = vi.fn();
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: null,
        orgId: 'org_acme',
        user: null,
        scopes: ['publish'],
      })),
      requireSubmitPublishScope,
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: { env: { DB: {} } },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-github-url' }),
      }),
    } as never);

    expect(response.status).toBe(400);
    expect(requireSubmitPublishScope).toHaveBeenCalledTimes(1);
    const payload = await response.json() as { code: string };
    expect(payload.code).toBe('invalid_repository_url');
  });

  it('supports repository-only submit checks without scanning skill files', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          description: 'Useful tools',
          stargazers_count: 42,
          default_branch: 'main',
          fork: false,
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: undefined,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=https://github.com/forker/toolbox&repoOnly=1'),
      url: new URL('https://skills.cat/api/submit?url=https://github.com/forker/toolbox&repoOnly=1'),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      owner: string;
      repo: string;
      repoName: string;
      description: string;
      stars: number;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      valid: true,
      owner: 'forker',
      repo: 'toolbox',
      repoName: 'toolbox',
      description: 'Useful tools',
      stars: 42,
    });
    expect(githubRequest).toHaveBeenCalledTimes(1);
  });

  it('uses the shared exhausted-budget snapshot before API calls and checks an exact path through raw GitHub', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const githubToken = 'snapshot-exhausted-token';
    const tokenId = await getGitHubTokenId(githubToken);
    const nowMs = Date.now();
    const kv = new MemoryRateLimitKv();
    kv.store.set(
      getRateLimitKvKey('rest', 'github-rate-limit', { tokenId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 0,
        used: 5000,
        resetAtEpochSec: Math.floor(nowMs / 1000) + 3600,
        updatedAtEpochMs: nowMs,
        source: 'headers',
        tokenId,
      })
    );

    const githubRequest = vi.fn(async () => {
      throw new Error('GitHub API must be skipped while the shared REST budget is exhausted');
    });
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: {
            name: 'main',
            refType: 'branch',
            currentOid: commitSha,
          },
          tree: {
            items: [{ path: 'skills', contentType: 'directory' }],
            totalCount: 1,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'toolbox',
            ownerLogin: 'forker',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'toolbox',
          ownerLogin: 'forker',
          stargazerCount: 42,
          forksCount: 3,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const publicFetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);

      if (requestUrl === 'https://github.com/forker/toolbox') {
        return new Response(repositoryHtml);
      }
      if (requestUrl === `https://raw.githubusercontent.com/forker/toolbox/${commitSha}/skills/alpha/SKILL.md`) {
        return new Response('# Alpha\n');
      }
      throw new Error(`Unexpected public GitHub request: ${requestUrl}`);
    });
    vi.stubGlobal('fetch', publicFetch);

    const queue = { send: vi.fn(async () => undefined) };
    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: buildDbMock(),
          KV: kv,
          GITHUB_TOKEN: githubToken,
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
          skillPath: 'skills/alpha',
        }),
      }),
    } as never);
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(githubRequest).not.toHaveBeenCalled();
    expect(publicFetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://github.com/forker/toolbox',
      `https://raw.githubusercontent.com/forker/toolbox/${commitSha}/skills/alpha/SKILL.md`,
    ]);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      repoOwner: 'forker',
      repoName: 'toolbox',
      skillPath: 'skills/alpha',
      skillFilePath: 'skills/alpha/SKILL.md',
    }));
  });

  it('uses the public ZIP fallback when rate-limit state is unavailable and GitHub API is limited', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock();
    const githubRequest = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: {
        'retry-after': '60',
        'x-ratelimit-remaining': '0',
      },
    }));
    const stateFetch = vi.fn(async () => {
      throw new Error('state unavailable');
    });
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: {
            name: 'main',
            refType: 'branch',
            currentOid: commitSha,
          },
          tree: {
            items: [
              { path: 'SKILL.md', contentType: 'file' },
              { path: 'skill.md', contentType: 'file' },
              { path: 'skills', contentType: 'directory' },
            ],
            totalCount: 3,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'toolbox',
            ownerLogin: 'forker',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'toolbox',
          ownerLogin: 'forker',
          stargazerCount: 42,
          forksCount: 3,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const archive = zipSync({
      [`toolbox-${commitSha}/SKILL.md`]: strToU8('# Root\n'),
      [`toolbox-${commitSha}/skill.md`]: strToU8('# Duplicate root casing\n'),
      [`toolbox-${commitSha}/skills/alpha/SKILL.md`]: strToU8('# Alpha\n'),
    });
    const publicFetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);

      if (requestUrl === 'https://github.com/forker/toolbox') {
        return new Response(repositoryHtml);
      }
      if (requestUrl === `https://codeload.github.com/forker/toolbox/zip/${commitSha}`) {
        return new Response(Uint8Array.from(archive).buffer);
      }
      throw new Error(`Unexpected public GitHub request: ${requestUrl}`);
    });
    vi.stubGlobal('fetch', publicFetch);

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: queue,
          STATE_DO: {
            idFromName: vi.fn(() => ({ name: 'github-rate-limit' })),
            get: vi.fn(() => ({ fetch: stateFetch })),
          },
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/forker/toolbox' }),
      }),
    } as never);
    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      results: Array<{ path: string; status: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, submitted: 2 });
    expect(payload.results).toHaveLength(2);
    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(queue.send.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ repoOwner: 'forker', repoName: 'toolbox', skillPath: '' }),
      expect.objectContaining({ repoOwner: 'forker', repoName: 'toolbox', skillPath: 'skills/alpha' }),
    ]);
    const prefetchCallIndex = db.prepare.mock.calls.findIndex(([sql]) =>
      sql.includes("COALESCE(skill_path, '') IN (")
    );
    expect(prefetchCallIndex).toBeGreaterThanOrEqual(0);
    expect(db.prepare.mock.invocationCallOrder[prefetchCallIndex]).toBeLessThan(
      queue.send.mock.invocationCallOrder[0]
    );
    expect(publicFetch).toHaveBeenCalledTimes(2);
    expect(stateFetch).toHaveBeenCalledTimes(1);
    // The first 429 marks the request as rate limited; later call sites
    // short-circuit to the public fallback instead of re-hitting the API.
    expect(githubRequest).toHaveBeenCalledTimes(1);

    githubRequest.mockClear();
    publicFetch.mockClear();
    queue.send.mockClear();

    const noTokenResponse = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/forker/toolbox' }),
      }),
    } as never);

    expect(noTokenResponse.status).toBe(200);
    expect(githubRequest).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledTimes(2);
    expect(queue.send).toHaveBeenCalledTimes(2);
  });

  it('refuses fork submissions when rate limiting leaves only the public fallback', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const githubRequest = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: {
        'retry-after': '60',
        'x-ratelimit-remaining': '0',
      },
    }));
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const forkRepositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: {
            name: 'main',
            refType: 'branch',
            currentOid: commitSha,
          },
          tree: {
            items: [{ path: 'SKILL.md', contentType: 'file' }],
            totalCount: 1,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'toolbox',
            ownerLogin: 'forker',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: true,
          },
        },
        sidebarAbout: {
          repoName: 'toolbox',
          ownerLogin: 'forker',
          stargazerCount: 42,
          forksCount: 3,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: true,
          },
        },
      },
    })}</script>`;
    const publicFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (requestUrl === 'https://github.com/forker/toolbox') {
        return new Response(forkRepositoryHtml);
      }
      throw new Error(`Unexpected public GitHub request: ${requestUrl}`);
    });
    vi.stubGlobal('fetch', publicFetch);

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: buildDbMock(),
          GITHUB_TOKEN: 'test-token',
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: { send: vi.fn(async () => undefined) },
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/forker/toolbox' }),
      }),
    } as never);
    const payload = await response.json() as { code: string };

    // The public fallback cannot see the fork parent, so the submission is
    // refused closed instead of skipping upstream verification.
    expect(response.status).toBe(503);
    expect(payload.code).toBe('fork_verification_failed');
    expect(publicFetch).toHaveBeenCalledTimes(1);
  });

  it('checks SKILL.md through the public snapshot when the contents request fails', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
        });
      }
      throw new Error(`Network failure for ${url}`);
    });
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: {
            name: 'main',
            refType: 'branch',
            currentOid: commitSha,
          },
          tree: {
            items: [{ path: 'skills', contentType: 'directory' }],
            totalCount: 1,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'toolbox',
            ownerLogin: 'forker',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'toolbox',
          ownerLogin: 'forker',
          stargazerCount: 42,
          forksCount: 3,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const archive = zipSync({
      [`toolbox-${commitSha}/skills/alpha/SKILL.md`]: strToU8('# Alpha\n'),
    });
    const publicFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (requestUrl === 'https://github.com/forker/toolbox') {
        return new Response(repositoryHtml);
      }
      if (requestUrl === `https://codeload.github.com/forker/toolbox/zip/${commitSha}`) {
        return new Response(Uint8Array.from(archive).buffer);
      }
      throw new Error(`Unexpected public GitHub request: ${requestUrl}`);
    });
    vi.stubGlobal('fetch', publicFetch);

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: buildDbMock(),
          GITHUB_TOKEN: 'test-token',
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
          skillPath: 'skills/alpha',
        }),
      }),
    } as never);
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(queue.send.mock.calls[0][0]).toEqual(
      expect.objectContaining({ repoOwner: 'forker', repoName: 'toolbox', skillPath: 'skills/alpha' })
    );
  });

  it('treats a truncated public scan without matches as inconclusive instead of no_skill_md_found', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
        });
      }
      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return new Response('not found', { status: 404 });
      }
      if (url === 'https://api.github.com/repos/forker/toolbox/git/trees/HEAD?recursive=1') {
        return new Response('rate limited', {
          status: 429,
          headers: {
            'retry-after': '60',
            'x-ratelimit-remaining': '0',
          },
        });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    // The HTML tree claims more entries than it lists and the ZIP is
    // unavailable, so the public snapshot is truncated: SKILL.md files may
    // exist beyond what the fallback could enumerate.
    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: {
            name: 'main',
            refType: 'branch',
            currentOid: commitSha,
          },
          tree: {
            items: [{ path: 'README.md', contentType: 'file' }],
            totalCount: 100,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'toolbox',
            ownerLogin: 'forker',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'toolbox',
          ownerLogin: 'forker',
          stargazerCount: 42,
          forksCount: 3,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const publicFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (requestUrl === 'https://github.com/forker/toolbox') {
        return new Response(repositoryHtml);
      }
      if (requestUrl === `https://codeload.github.com/forker/toolbox/zip/${commitSha}`) {
        return new Response('not found', { status: 404 });
      }
      throw new Error(`Unexpected public GitHub request: ${requestUrl}`);
    });
    vi.stubGlobal('fetch', publicFetch);

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: buildDbMock(),
          GITHUB_TOKEN: 'test-token',
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: { send: vi.fn(async () => undefined) },
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/forker/toolbox' }),
      }),
    } as never);
    const payload = await response.json() as { code: string };

    // A truncated snapshot cannot prove absence, so the request must surface
    // the upstream rate limit instead of a false no_skill_md_found verdict.
    expect(response.status).toBe(429);
    expect(payload.code).toBe('github_rate_limited');
  });

  it('checks commit-pinned raw SKILL.md when a root snapshot is truncated', async () => {
    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
        });
      }
      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return new Response('rate limited', {
          status: 429,
          headers: {
            'retry-after': '60',
            'x-ratelimit-remaining': '0',
          },
        });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const repositoryHtml = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
      payload: {
        codeViewRepoRoute: {
          refInfo: {
            name: 'main',
            refType: 'branch',
            currentOid: commitSha,
          },
          tree: {
            items: [{ path: 'README.md', contentType: 'file' }],
            totalCount: 100,
          },
        },
        codeViewLayoutRoute: {
          repo: {
            id: 123,
            name: 'toolbox',
            ownerLogin: 'forker',
            defaultBranch: 'main',
            createdAt: '2026-01-02T03:04:05Z',
            private: false,
            public: true,
            isOrgOwned: false,
            isFork: false,
          },
        },
        sidebarAbout: {
          repoName: 'toolbox',
          ownerLogin: 'forker',
          stargazerCount: 42,
          forksCount: 3,
          repo: {
            ownerId: 456,
            ownerAvatarUrl: 'https://avatars.githubusercontent.com/u/456?v=4',
            isPrivate: false,
            isFork: false,
          },
        },
      },
    })}</script>`;
    const publicFetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const headers = new Headers(init?.headers);
      expect(headers.has('Authorization')).toBe(false);
      expect(headers.has('Cookie')).toBe(false);

      if (requestUrl === 'https://github.com/forker/toolbox') {
        return new Response(repositoryHtml);
      }
      if (requestUrl === `https://codeload.github.com/forker/toolbox/zip/${commitSha}`) {
        return new Response('not found', { status: 404 });
      }
      if (requestUrl === `https://raw.githubusercontent.com/forker/toolbox/${commitSha}/SKILL.md`) {
        return new Response('# Root skill\n');
      }
      throw new Error(`Unexpected public GitHub request: ${requestUrl}`);
    });
    vi.stubGlobal('fetch', publicFetch);

    const queue = { send: vi.fn(async () => undefined) };
    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: buildDbMock(),
          GITHUB_TOKEN: 'test-token',
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/forker/toolbox' }),
      }),
    } as never);
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(publicFetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://github.com/forker/toolbox',
      `https://codeload.github.com/forker/toolbox/zip/${commitSha}`,
      `https://raw.githubusercontent.com/forker/toolbox/${commitSha}/SKILL.md`,
    ]);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      repoOwner: 'forker',
      repoName: 'toolbox',
      skillPath: '',
      skillFilePath: 'SKILL.md',
    }));
  });

  it('never issues public fallback requests from the anonymous submit precheck', async () => {
    const githubRequest = vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: {
        'retry-after': '60',
        'x-ratelimit-remaining': '0',
      },
    }));
    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));

    const publicFetch = vi.fn(async () => {
      throw new Error('Public fallback must not run during precheck');
    });
    vi.stubGlobal('fetch', publicFetch);

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'en' },
      platform: {
        env: {
          GITHUB_TOKEN: 'test-token',
          GITHUB_HTML_SUBMIT_FALLBACK_ENABLED: '1',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
      url: new URL('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
    } as never);
    const payload = await response.json() as { valid: boolean; code: string };

    expect(response.status).toBe(429);
    expect(payload).toMatchObject({ valid: false, code: 'github_rate_limited' });
    expect(publicFetch).not.toHaveBeenCalled();
  });

  it('returns localized fork errors for submit precheck', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'identical',
          ahead_by: 0,
          behind_by: 0,
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: undefined,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=https://github.com/forker/toolbox', {
        headers: {
          'x-skillscat-locale': 'zh-CN',
        },
      }),
      url: new URL('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      code: string;
      error: string;
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(false);
    expect(payload.code).toBe('fork_no_unique_commits');
    expect(payload.error).toContain('没有新增提交');
  });

  it('returns localized fork errors based on the frontend locale header', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'identical',
          ahead_by: 0,
          behind_by: 0,
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: {},
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: {},
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-skillscat-locale': 'zh-CN',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      code: string;
      error: string;
    };

    expect(response.status).toBe(400);
    expect(payload.code).toBe('fork_no_unique_commits');
    expect(payload.error).toContain('没有新增提交');
    expect(payload.error).toContain('upstream/toolbox');
  });

  it('rejects forks that are behind upstream', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'diverged',
          ahead_by: 2,
          behind_by: 3,
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: {},
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: {},
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      code: string;
      error: string;
    };

    expect(response.status).toBe(400);
    expect(payload.code).toBe('fork_behind_upstream');
    expect(payload.error).toContain('3 commit(s) behind upstream upstream/toolbox');
  });

  it('allows ahead-only forks during submit precheck', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'zh-CN' },
      platform: {
        env: {
          DB: undefined,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
      url: new URL('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      owner: string;
      repo: string;
      path: string;
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(true);
    expect(payload.owner).toBe('forker');
    expect(payload.repo).toBe('toolbox');
    expect(payload.path).toBe('');
  });

  it('trims whitespace around repository URLs during submit precheck', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: undefined,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=%20%20https%3A%2F%2Fgithub.com%2Fforker%2Ftoolbox%20%20'),
      url: new URL('https://skills.cat/api/submit?url=%20%20https%3A%2F%2Fgithub.com%2Fforker%2Ftoolbox%20%20'),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      owner: string;
      repo: string;
      path: string;
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(true);
    expect(payload.owner).toBe('forker');
    expect(payload.repo).toBe('toolbox');
    expect(payload.path).toBe('');
  });

  it('resolves skills.sh URLs to the underlying GitHub repository during submit precheck', async () => {
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const skillsShUrl = encodeURIComponent('https://skills.sh/forker/toolbox/my-skill');
    const response = await GET({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: undefined,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request(`https://skills.cat/api/submit?url=${skillsShUrl}`),
      url: new URL(`https://skills.cat/api/submit?url=${skillsShUrl}`),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      owner: string;
      repo: string;
      path: string;
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(true);
    expect(payload.owner).toBe('forker');
    expect(payload.repo).toBe('toolbox');
    expect(payload.path).toBe('');
  });

  it('treats existing skills as valid during submit precheck', async () => {
    const db = buildDbMock({
      '': {
        slug: 'forker/toolbox',
        tier: 'warm',
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'zh-CN' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
      url: new URL('https://skills.cat/api/submit?url=https://github.com/forker/toolbox'),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      code?: string;
      message?: string;
      existingSlug?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(true);
    expect(payload.code).toBe('skill_already_exists');
    expect(payload.message).toContain('已经存在');
    expect(payload.existingSlug).toBe('forker/toolbox');
  });

  it('returns success when a single submitted skill already exists', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      '': {
        id: 'skill_existing',
        slug: 'forker/toolbox',
        tier: 'warm',
        indexedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      message: string;
      existingSlug?: string;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(1);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.message).toContain('already exists');
    expect(payload.existingSlug).toBe('forker/toolbox');
    expect(payload.results).toEqual([
      {
        path: 'SKILL.md',
        status: 'exists',
        slug: 'forker/toolbox',
        refreshQueued: false,
      },
    ]);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('queues a refresh check for stale existing cold skills on submit', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      '': {
        id: 'skill_existing',
        slug: 'forker/toolbox',
        tier: 'cold',
        indexedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      message: string;
      existingSlug?: string;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(1);
    expect(payload.refreshQueued).toBe(1);
    expect(payload.message).toContain('queued a refresh check');
    expect(payload.existingSlug).toBe('forker/toolbox');
    expect(payload.results).toEqual([
      {
        path: 'SKILL.md',
        status: 'exists',
        slug: 'forker/toolbox',
        refreshQueued: true,
      },
    ]);
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it('submits nested skills alongside an existing root skill when the root repository is submitted', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      '': {
        slug: 'forker/toolbox',
        tier: 'warm',
        indexedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/git/trees/HEAD?recursive=1') {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob' },
            { path: 'skills/alpha/SKILL.md', type: 'blob' },
          ],
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(1);
    expect(payload.existing).toBe(1);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.results).toEqual([
      {
        path: 'SKILL.md',
        status: 'exists',
        slug: 'forker/toolbox',
        refreshQueued: false,
      },
      {
        path: 'skills/alpha/SKILL.md',
        status: 'queued',
      },
    ]);
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      repoOwner: 'forker',
      repoName: 'toolbox',
      skillPath: 'skills/alpha',
      submissionUserId: 'user_1',
    }), expect.anything());
    expect(
      db.prepare.mock.calls.filter(([sql]) => sql.includes("COALESCE(skill_path, '') IN ("))
    ).toHaveLength(1);
    expect(
      db.prepare.mock.calls.filter(([sql]) =>
        sql.includes('SELECT id, slug, tier, next_update_at, indexed_at FROM skills')
        && sql.includes("COALESCE(skill_path, '') = ?")
      )
    ).toHaveLength(0);
  });

  it('returns existing results for root submit when root and nested skills already exist without requiring a queue', async () => {
    const db = buildDbMock({
      '': {
        slug: 'forker/toolbox',
        tier: 'warm',
        indexedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
      'skills/alpha': {
        slug: 'forker/alpha-skill',
        tier: 'warm',
        indexedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/git/trees/HEAD?recursive=1') {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob' },
            { path: 'skills/alpha/SKILL.md', type: 'blob' },
          ],
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(2);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.results).toEqual([
      {
        path: 'SKILL.md',
        status: 'exists',
        slug: 'forker/toolbox',
        refreshQueued: false,
      },
      {
        path: 'skills/alpha/SKILL.md',
        status: 'exists',
        slug: 'forker/alpha-skill',
        refreshQueued: false,
      },
    ]);
  });

  it('does not treat immediate trending refresh sentinels as an indexing refresh queue signal', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      '': {
        slug: 'forker/toolbox',
        tier: 'cold',
        nextUpdateAt: -Date.now(),
        indexedAt: Date.now() - 5 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
          owner: { login: 'forker' },
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(1);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.results).toEqual([
      {
        path: 'SKILL.md',
        status: 'exists',
        slug: 'forker/toolbox',
        refreshQueued: false,
      },
    ]);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('directly resurrects archived skills during root multi-submit before queueing remaining skills', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      '': {
        id: 'archived-root-id',
        slug: 'forker/toolbox',
        tier: 'archived',
      },
    });
    const r2 = {} as R2Bucket;

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/git/trees/HEAD?recursive=1') {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob' },
            { path: 'skills/alpha/SKILL.md', type: 'blob' },
          ],
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const restoreArchivedSkillFromR2 = vi.fn(async () => true);

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));
    vi.doMock('../src/lib/server/skill/resurrection', () => ({
      restoreArchivedSkillFromR2,
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          R2: r2,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      resurrected: number;
      refreshQueued: number;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(1);
    expect(payload.existing).toBe(0);
    expect(payload.resurrected).toBe(1);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.message).toContain('Restored 1 archived skill');
    expect(payload.results).toEqual([
      {
        path: 'SKILL.md',
        status: 'resurrected',
        slug: 'forker/toolbox',
      },
      {
        path: 'skills/alpha/SKILL.md',
        status: 'queued',
      },
    ]);
    expect(restoreArchivedSkillFromR2).toHaveBeenCalledWith({
      db,
      r2,
      skillId: 'archived-root-id',
    });
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      repoOwner: 'forker',
      repoName: 'toolbox',
      skillPath: 'skills/alpha',
    }), expect.anything());
  });

  it('does not queue a refresh check for recently indexed existing cold skills', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      '': {
        id: 'skill_existing',
        slug: 'forker/toolbox',
        tier: 'cold',
        indexedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      refreshQueued: number;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.message).toContain('already exists');
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('returns success when every discovered skill already exists', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      'skills/alpha': {
        slug: 'forker/alpha-skill',
        tier: 'warm',
        indexedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
      'skills/beta': {
        slug: 'forker/beta-skill',
        tier: 'hot',
        indexedAt: Date.now() - 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({ message: 'Not Found' }, 404);
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/git/trees/HEAD?recursive=1') {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'skills/alpha/SKILL.md', type: 'blob' },
            { path: 'skills/beta/SKILL.md', type: 'blob' },
          ],
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      message: string;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(2);
    expect(payload.refreshQueued).toBe(0);
    expect(payload.message).toContain('2 already exist');
    expect(payload.results).toEqual([
      {
        path: 'skills/alpha/SKILL.md',
        status: 'exists',
        slug: 'forker/alpha-skill',
        refreshQueued: false,
      },
      {
        path: 'skills/beta/SKILL.md',
        status: 'exists',
        slug: 'forker/beta-skill',
        refreshQueued: false,
      },
    ]);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it('queues refresh checks for stale existing skills found during multi-skill submit', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock({
      'skills/alpha': {
        slug: 'forker/alpha-skill',
        tier: 'cold',
        indexedAt: Date.now() - 45 * 24 * 60 * 60 * 1000,
      },
      'skills/beta': {
        slug: 'forker/beta-skill',
        tier: 'cold',
        indexedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      },
    });

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({ message: 'Not Found' }, 404);
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/git/trees/HEAD?recursive=1') {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: 'skills/alpha/SKILL.md', type: 'blob' },
            { path: 'skills/beta/SKILL.md', type: 'blob' },
          ],
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      refreshQueued: number;
      message: string;
      results: Array<{ path: string; status: string; slug?: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(2);
    expect(payload.refreshQueued).toBe(1);
    expect(payload.message).toBe([
      '2 already exist.',
      '1 existing skill(s) were queued for refresh.',
    ].join('\n'));
    expect(payload.results).toEqual([
      {
        path: 'skills/alpha/SKILL.md',
        status: 'exists',
        slug: 'forker/alpha-skill',
        refreshQueued: true,
      },
      {
        path: 'skills/beta/SKILL.md',
        status: 'exists',
        slug: 'forker/beta-skill',
        refreshQueued: false,
      },
    ]);
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it('accepts forks that are ahead of upstream and not behind', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock();

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: true,
          parent: {
            name: 'toolbox',
            full_name: 'upstream/toolbox',
            default_branch: 'main',
            owner: { login: 'upstream' },
          },
        });
      }

      if (url === 'https://api.github.com/repos/upstream/toolbox/compare/upstream%3Amain...forker%3Amain') {
        return jsonResponse({
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'zh-CN' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toContain('提交成功');
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it('submits with an organization principal and trims whitespace around repository URLs', async () => {
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const db = buildDbMock();

    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          default_branch: 'main',
          fork: false,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: 'SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: null,
        orgId: 'org_acme',
        user: null,
        scopes: ['publish'],
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: '  https://github.com/forker/toolbox  ',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
      submitted: number;
      existing: number;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(1);
    expect(payload.existing).toBe(0);
    expect(payload.message).toContain('submitted successfully');
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      repoOwner: 'forker',
      repoName: 'toolbox',
      skillPath: '',
      submittedBy: 'org:org_acme',
    }));
    expect(queue.send.mock.calls[0]?.[0]).not.toHaveProperty('submissionUserId');
  });

  it('accepts dot-folder skills during submit precheck', async () => {
    const db = buildDbMock();
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          description: 'Dot folder skills are welcome',
          stargazers_count: 3,
          default_branch: 'main',
          fork: false,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/.claude/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: '.claude/SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { GET } = await import('../src/routes/api/submit/+server');
    const response = await GET({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
        },
      },
      request: new Request('https://skills.cat/api/submit?url=https://github.com/forker/toolbox/tree/main/.claude'),
      url: new URL('https://skills.cat/api/submit?url=https://github.com/forker/toolbox/tree/main/.claude'),
    } as never);

    const payload = await response.json() as {
      valid: boolean;
      path: string;
      repoName: string;
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(true);
    expect(payload.path).toBe('.claude');
    expect(payload.repoName).toBe('toolbox');
  });

  it('queues dot-folder skills for submission without a star gate', async () => {
    const db = buildDbMock();
    const queue = {
      send: vi.fn(async () => undefined),
    };
    const githubRequest = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/forker/toolbox') {
        return jsonResponse({
          name: 'toolbox',
          description: 'Dot folder skills are welcome',
          stargazers_count: 3,
          default_branch: 'main',
          fork: false,
        });
      }

      if (url === 'https://api.github.com/repos/forker/toolbox/contents/.claude/SKILL.md') {
        return jsonResponse({
          name: 'SKILL.md',
          path: '.claude/SKILL.md',
          type: 'file',
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    vi.doMock('../src/lib/server/github-client/request', () => ({ githubRequest }));
    vi.doMock('../src/lib/server/auth/middleware', () => ({
      getAuthContext: vi.fn(async () => ({
        userId: 'user_1',
        user: { id: 'user_1' },
      })),
      requireSubmitPublishScope: vi.fn(),
    }));

    const { POST } = await import('../src/routes/api/submit/+server');
    const response = await POST({
      locals: { locale: 'en' },
      platform: {
        env: {
          DB: db,
          GITHUB_TOKEN: 'test-token',
          INDEXING_QUEUE: queue,
        },
      },
      request: new Request('https://skills.cat/api/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://github.com/forker/toolbox',
          skillPath: '.claude',
        }),
      }),
    } as never);

    const payload = await response.json() as {
      success: boolean;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      repoOwner: 'forker',
      repoName: 'toolbox',
      skillPath: '.claude',
      submissionUserId: 'user_1',
    }));
  });
});
