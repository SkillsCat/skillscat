import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

import { githubRequest } from '../src/lib/server/github-request';
import { getViewerOrgMembership } from '../src/lib/server/github-client/rest';

class MemoryCache {
  private readonly map = new Map<string, Response>();
  matchCalls = 0;
  putCalls = 0;

  async match(request: Request): Promise<Response | undefined> {
    this.matchCalls += 1;
    const hit = this.map.get(request.url);
    return hit?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.putCalls += 1;
    this.map.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    return this.map.delete(request.url);
  }
}

function installCache(cache: MemoryCache): void {
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    writable: true,
    value: { default: cache },
  });
}

describe('GitHub gateway', () => {
  beforeEach(() => {
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: webcrypto,
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses cached REST response when conditional GET returns 304 for unauthenticated requests', async () => {
    const cache = new MemoryCache();
    installCache(cache);

    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: 1 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: '"abc"',
        },
      }))
      .mockImplementationOnce(async (_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('If-None-Match')).toBe('"abc"');
        return new Response(null, { status: 304, headers: { ETag: '"abc"' } });
      });

    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://api.github.com/repos/foo/bar';
    const first = await githubRequest(url);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ value: 1 });

    const second = await githubRequest(url);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ value: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.matchCalls).toBeGreaterThanOrEqual(1);
    expect(cache.putCalls).toBe(1);
  });

  it('does not use shared cache for authenticated REST GET requests', async () => {
    const cache = new MemoryCache();
    installCache(cache);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"abc"' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://api.github.com/repos/foo/bar';
    const first = await githubRequest(url, { token: 't1' });
    expect(first.status).toBe(200);
    const second = await githubRequest(url, { token: 't2' });
    expect(second.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cache.matchCalls).toBe(0);
    expect(cache.putCalls).toBe(0);
  });

  it('falls back to GraphQL for supported REST endpoint on rate limit', async () => {
    const cache = new MemoryCache();
    installCache(cache);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/foo/bar') {
        return new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
            'x-ratelimit-remaining': '0',
          },
        });
      }

      if (url === 'https://api.github.com/graphql') {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          data: {
            repository: {
              databaseId: 123,
              name: 'bar',
              owner: {
                __typename: 'User',
                login: 'foo',
                avatarUrl: 'https://avatars.githubusercontent.com/u/1',
                databaseId: 1,
              },
              url: 'https://github.com/foo/bar',
              description: 'desc',
              isFork: false,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-02T00:00:00Z',
              pushedAt: '2024-01-03T00:00:00Z',
              homepageUrl: null,
              stargazerCount: 10,
              forkCount: 2,
              watchers: { totalCount: 10 },
              primaryLanguage: { name: 'TypeScript' },
              licenseInfo: { key: 'mit', name: 'MIT License', spdxId: 'MIT' },
              repositoryTopics: { nodes: [{ topic: { name: 'ai' } }] },
              defaultBranchRef: { name: 'main' },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await githubRequest('https://api.github.com/repos/foo/bar', { token: 't' });
    expect(response.status).toBe(200);
    const data = await response.json() as { default_branch: string; owner: { login: string } };
    expect(data.owner.login).toBe('foo');
    expect(data.default_branch).toBe('main');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('supports organization logins in /users/{login} GraphQL fallback', async () => {
    const cache = new MemoryCache();
    installCache(cache);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/users/acme') {
        return new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 429,
          headers: { 'x-ratelimit-remaining': '0' },
        });
      }

      if (url === 'https://api.github.com/graphql') {
        return new Response(JSON.stringify({
          data: {
            repositoryOwner: {
              __typename: 'Organization',
              databaseId: 42,
              login: 'acme',
              avatarUrl: 'https://avatars.githubusercontent.com/u/42',
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await githubRequest('https://api.github.com/users/acme');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      login: 'acme',
      type: 'Organization',
    });
  });

  it('returns REST rate-limit response when GraphQL fallback is also rate limited', async () => {
    const cache = new MemoryCache();
    installCache(cache);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/foo/bar') {
        return new Response('rest limited', {
          status: 429,
          headers: { 'x-ratelimit-remaining': '0' },
        });
      }
      if (url === 'https://api.github.com/graphql') {
        return new Response('graphql limited', {
          status: 429,
          headers: { 'x-ratelimit-remaining': '0' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await githubRequest('https://api.github.com/repos/foo/bar', { token: 't' });
    expect(response.status).toBe(429);
    expect(await response.text()).toContain('rest limited');
  });

  it('does not use shared cache for viewer-scoped membership endpoint', async () => {
    const cache = new MemoryCache();
    installCache(cache);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ role: 'admin', state: 'active' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await getViewerOrgMembership('acme', { token: 'user-token' });
    expect(response.status).toBe(200);
    expect(cache.matchCalls).toBe(0);
    expect(cache.putCalls).toBe(0);
  });
});
