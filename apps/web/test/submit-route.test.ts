import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
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
  vi.unmock('../src/lib/server/github-client/request');
  vi.unmock('../src/lib/server/auth/middleware');
});

describe('submit route', () => {
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
      results: Array<{ path: string; refreshQueued?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.submitted).toBe(0);
    expect(payload.existing).toBe(2);
    expect(payload.refreshQueued).toBe(1);
    expect(payload.message).toContain('2 already exist');
    expect(payload.message).toContain('1 existing skill');
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
    }));
  });
});
