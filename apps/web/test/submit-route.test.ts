import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function buildDbMock() {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT id, slug, tier FROM skills')) {
        return {
          bind: () => ({
            first: vi.fn(async () => null),
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
  vi.unmock('../src/lib/server/github-request');
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

    vi.doMock('../src/lib/server/github-request', () => ({ githubRequest }));
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

    vi.doMock('../src/lib/server/github-request', () => ({ githubRequest }));
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

    vi.doMock('../src/lib/server/github-request', () => ({ githubRequest }));
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

    vi.doMock('../src/lib/server/github-request', () => ({ githubRequest }));
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

    vi.doMock('../src/lib/server/github-request', () => ({ githubRequest }));
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
});
