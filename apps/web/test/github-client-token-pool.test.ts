import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRateLimit } from '../src/lib/server/github-client/rest';
import { githubRequest } from '../src/lib/server/github-client/request';
import {
  getRateLimitKvKey,
  readAggregatedRateLimitSnapshot,
  readRateLimitSnapshot,
} from '../src/lib/server/github-client/rate-limit-kv';
import { getGitHubTokenId } from '../src/lib/server/github-client/token-pool';

class MemoryKv {
  private readonly store = new Map<string, string>();
  putCalls = 0;

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.putCalls += 1;
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('github token pool', () => {
  it('rotates to the next token when the current token is rate limited', async () => {
    const kv = new MemoryKv();
    const seenAuthHeaders: string[] = [];
    const resetAt = String(Math.floor(Date.now() / 1000) + 300);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const authHeader = new Headers(init?.headers).get('Authorization') || '';
      seenAuthHeaders.push(authHeader);

      if (authHeader === 'Bearer token-a') {
        return jsonResponse(
          { message: 'rate limited' },
          403,
          {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-used': '5000',
            'x-ratelimit-reset': resetAt,
          }
        );
      }

      return jsonResponse(
        { ok: true },
        200,
        {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-used': '1',
          'x-ratelimit-reset': resetAt,
        }
      );
    });

    const response = await githubRequest('https://api.github.com/repos/skillscat/demo', {
      token: ['token-a', 'token-b'],
      rateLimitKV: kv as never,
    });

    expect(response.ok).toBe(true);
    expect(seenAuthHeaders).toEqual(['Bearer token-a', 'Bearer token-b']);

    const tokenAId = await getGitHubTokenId('token-a');
    const tokenBId = await getGitHubTokenId('token-b');

    await expect(readRateLimitSnapshot('rest', {
      kv: kv as never,
      tokenId: tokenAId,
    })).resolves.toEqual(expect.objectContaining({
      remaining: 0,
      tokenId: tokenAId,
    }));

    await expect(readRateLimitSnapshot('rest', {
      kv: kv as never,
      tokenId: tokenBId,
    })).resolves.toEqual(expect.objectContaining({
      remaining: 4999,
      tokenId: tokenBId,
    }));
  });

  it('prefers the token with remaining budget when fresh snapshots exist', async () => {
    const kv = new MemoryKv();
    const tokenAId = await getGitHubTokenId('token-a');
    const tokenBId = await getGitHubTokenId('token-b');
    const now = Date.now();
    const resetAt = Math.floor(now / 1000) + 600;

    await kv.put(
      getRateLimitKvKey('rest', undefined, { tokenId: tokenAId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 0,
        used: 5000,
        resetAtEpochSec: resetAt,
        updatedAtEpochMs: now,
        source: 'headers',
        tokenId: tokenAId,
      })
    );

    await kv.put(
      getRateLimitKvKey('rest', undefined, { tokenId: tokenBId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 3200,
        used: 1800,
        resetAtEpochSec: resetAt,
        updatedAtEpochMs: now,
        source: 'headers',
        tokenId: tokenBId,
      })
    );

    const seenAuthHeaders: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seenAuthHeaders.push(new Headers(init?.headers).get('Authorization') || '');
      return jsonResponse(
        { ok: true },
        200,
        {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '3199',
          'x-ratelimit-used': '1801',
          'x-ratelimit-reset': String(resetAt),
        }
      );
    });

    const response = await githubRequest('https://api.github.com/repos/skillscat/demo', {
      token: ['token-a', 'token-b'],
      rateLimitKV: kv as never,
    });

    expect(response.ok).toBe(true);
    expect(seenAuthHeaders).toEqual(['Bearer token-b']);
  });

  it('keeps pooled-token ordering without rewriting successful snapshots in rate-limit-only mode', async () => {
    const kv = new MemoryKv();
    const tokenAId = await getGitHubTokenId('token-a');
    const tokenBId = await getGitHubTokenId('token-b');
    const now = Date.now();
    const resetAt = Math.floor(now / 1000) + 600;

    await kv.put(
      getRateLimitKvKey('rest', undefined, { tokenId: tokenAId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 0,
        used: 5000,
        resetAtEpochSec: resetAt,
        updatedAtEpochMs: now,
        source: 'headers',
        tokenId: tokenAId,
      })
    );

    await kv.put(
      getRateLimitKvKey('rest', undefined, { tokenId: tokenBId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 3200,
        used: 1800,
        resetAtEpochSec: resetAt,
        updatedAtEpochMs: now,
        source: 'headers',
        tokenId: tokenBId,
      })
    );

    kv.putCalls = 0;

    const seenAuthHeaders: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      seenAuthHeaders.push(new Headers(init?.headers).get('Authorization') || '');
      return jsonResponse(
        { ok: true },
        200,
        {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '3199',
          'x-ratelimit-used': '1801',
          'x-ratelimit-reset': String(resetAt),
        }
      );
    });

    const response = await githubRequest('https://api.github.com/repos/skillscat/demo', {
      token: ['token-a', 'token-b'],
      rateLimitKV: kv as never,
      rateLimitWritePolicy: 'rate_limit_only',
    });

    expect(response.ok).toBe(true);
    expect(seenAuthHeaders).toEqual(['Bearer token-b']);
    expect(kv.putCalls).toBe(0);
  });

  it('aggregates remaining rate-limit budget across token snapshots', async () => {
    const kv = new MemoryKv();
    const tokenAId = await getGitHubTokenId('token-a');
    const tokenBId = await getGitHubTokenId('token-b');
    const now = Date.now();

    await kv.put(
      getRateLimitKvKey('rest', undefined, { tokenId: tokenAId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 1200,
        used: 3800,
        resetAtEpochSec: Math.floor(now / 1000) + 300,
        updatedAtEpochMs: now,
        source: 'headers',
        tokenId: tokenAId,
      })
    );

    await kv.put(
      getRateLimitKvKey('rest', undefined, { tokenId: tokenBId }),
      JSON.stringify({
        bucket: 'rest',
        limit: 5000,
        remaining: 800,
        used: 4200,
        resetAtEpochSec: Math.floor(now / 1000) + 900,
        updatedAtEpochMs: now,
        source: 'headers',
        tokenId: tokenBId,
      })
    );

    const snapshot = await readAggregatedRateLimitSnapshot('rest', {
      kv: kv as never,
      tokenIds: [tokenAId, tokenBId],
      maxAgeMs: 60_000,
    });

    expect(snapshot).toEqual(expect.objectContaining({
      source: 'aggregate',
      limit: 10000,
      remaining: 2000,
      used: 8000,
      tokenCount: 2,
      knownTokenCount: 2,
      resetAtEpochSec: Math.floor(now / 1000) + 900,
    }));
  });

  it('stores rate_limit snapshots without an extra rest header write', async () => {
    const kv = new MemoryKv();
    const resetAt = Math.floor(Date.now() / 1000) + 300;

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      resources: {
        core: {
          limit: 5000,
          remaining: 4200,
          used: 800,
          reset: resetAt,
        },
        graphql: {
          limit: 5000,
          remaining: 4700,
          used: 300,
          reset: resetAt,
        },
      },
    }, 200, {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4200',
      'x-ratelimit-used': '800',
      'x-ratelimit-reset': String(resetAt),
    }));

    const response = await getRateLimit({
      token: 'token-a',
      rateLimitKV: kv as never,
    });

    expect(response.ok).toBe(true);
    expect(kv.putCalls).toBe(2);

    const tokenId = await getGitHubTokenId('token-a');
    await expect(readRateLimitSnapshot('rest', {
      kv: kv as never,
      tokenId,
    })).resolves.toEqual(expect.objectContaining({
      remaining: 4200,
      tokenId,
    }));
    await expect(readRateLimitSnapshot('graphql', {
      kv: kv as never,
      tokenId,
    })).resolves.toEqual(expect.objectContaining({
      remaining: 4700,
      tokenId,
    }));
  });

  it('skips rewriting identical rate_limit snapshots within the noop window', async () => {
    const kv = new MemoryKv();
    const resetAt = Math.floor(Date.now() / 1000) + 300;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
      resources: {
        core: {
          limit: 5000,
          remaining: 4200,
          used: 800,
          reset: resetAt,
        },
        graphql: {
          limit: 5000,
          remaining: 4700,
          used: 300,
          reset: resetAt,
        },
      },
    }, 200, {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4200',
      'x-ratelimit-used': '800',
      'x-ratelimit-reset': String(resetAt),
    }));

    const first = await getRateLimit({
      token: 'token-a',
      rateLimitKV: kv as never,
    });
    const second = await getRateLimit({
      token: 'token-a',
      rateLimitKV: kv as never,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(kv.putCalls).toBe(2);
  });

  it('writes only the exhausted token snapshot when a pooled request is rate limited in rate-limit-only mode', async () => {
    const kv = new MemoryKv();
    const seenAuthHeaders: string[] = [];
    const resetAt = String(Math.floor(Date.now() / 1000) + 300);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const authHeader = new Headers(init?.headers).get('Authorization') || '';
      seenAuthHeaders.push(authHeader);

      if (authHeader === 'Bearer token-a') {
        return jsonResponse(
          { message: 'rate limited' },
          403,
          {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-used': '5000',
            'x-ratelimit-reset': resetAt,
          }
        );
      }

      return jsonResponse(
        { ok: true },
        200,
        {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4999',
          'x-ratelimit-used': '1',
          'x-ratelimit-reset': resetAt,
        }
      );
    });

    const response = await githubRequest('https://api.github.com/repos/skillscat/demo', {
      token: ['token-a', 'token-b'],
      rateLimitKV: kv as never,
      rateLimitWritePolicy: 'rate_limit_only',
    });

    expect(response.ok).toBe(true);
    expect(seenAuthHeaders).toEqual(['Bearer token-a', 'Bearer token-b']);
    expect(kv.putCalls).toBe(1);

    const tokenAId = await getGitHubTokenId('token-a');
    const tokenBId = await getGitHubTokenId('token-b');

    await expect(readRateLimitSnapshot('rest', {
      kv: kv as never,
      tokenId: tokenAId,
    })).resolves.toEqual(expect.objectContaining({
      remaining: 0,
      tokenId: tokenAId,
    }));
    await expect(readRateLimitSnapshot('rest', {
      kv: kv as never,
      tokenId: tokenBId,
    })).resolves.toBeNull();
  });
});
