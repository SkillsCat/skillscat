import { afterEach, describe, expect, it, vi } from 'vitest';

import githubEventsWorker from '../workers/github-events';
import {
  buildRepoQueuedDedupIdentity,
  computeAllowedSearchPages,
  shouldRunSearchDiscoveryThisTick,
} from '../workers/github-events';

function jsonResponse(body: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

class MemoryKv {
  readonly store = new Map<string, string>();
  readonly putKeys: string[] = [];

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.putKeys.push(key);
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('github-events helpers', () => {
  it('throttles code search to one run per configured interval window', () => {
    expect(shouldRunSearchDiscoveryThisTick(0, 300, 900)).toBe(true);
    expect(shouldRunSearchDiscoveryThisTick(300_000, 300, 900)).toBe(false);
    expect(shouldRunSearchDiscoveryThisTick(600_000, 300, 900)).toBe(false);
    expect(shouldRunSearchDiscoveryThisTick(900_000, 300, 900)).toBe(true);
    expect(shouldRunSearchDiscoveryThisTick(1_200_000, 300, 900)).toBe(false);
    expect(shouldRunSearchDiscoveryThisTick(1_800_000, 300, 900)).toBe(true);
  });

  it('always runs code search when the configured interval is not wider than the cron interval', () => {
    expect(shouldRunSearchDiscoveryThisTick(300_000, 300, 300)).toBe(true);
    expect(shouldRunSearchDiscoveryThisTick(300_000, 300, 60)).toBe(true);
  });

  it('normalizes repo queue dedupe identities for root and nested skill paths', () => {
    expect(buildRepoQueuedDedupIdentity('Owner', 'Repo')).toBe('owner/repo:');
    expect(buildRepoQueuedDedupIdentity('Owner', 'Repo', '/Nested/Path/')).toBe('owner/repo:nested/path');
  });

  it('keeps search page budgeting behavior unchanged', () => {
    expect(computeAllowedSearchPages(1, 1500, 900, 300, 300, 0)).toBe(1);
    expect(computeAllowedSearchPages(3, 250, 900, 300, 300, 0)).toBe(0);
  });

  it('does not persist per-event processed markers during scheduled discovery', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === 'https://api.github.com/rate_limit') {
        return jsonResponse({
          resources: {
            core: {
              limit: 5000,
              remaining: 4900,
              used: 100,
              reset: resetAt,
            },
            graphql: {
              limit: 5000,
              remaining: 5000,
              used: 0,
              reset: resetAt,
            },
          },
        }, 200, {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4900',
          'x-ratelimit-used': '100',
          'x-ratelimit-reset': String(resetAt),
        });
      }

      if (url.startsWith('https://api.github.com/events?')) {
        return jsonResponse([
          {
            id: 'evt-push',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:01Z',
            repo: { name: 'Acme/Toolbox' },
          },
          {
            id: 'evt-issue',
            type: 'IssuesEvent',
            created_at: '2026-04-18T00:00:00Z',
            repo: { name: 'Acme/Toolbox' },
          },
        ]);
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => {
            sent.push(message);
          },
        },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_DISCOVERY_MIN_REST_REMAINING: '1',
        GITHUB_DISCOVERY_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
      } as never,
      {} as ExecutionContext
    );

    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Acme',
        repoName: 'Toolbox',
      }),
    ]);
    expect(Array.from(kv.store.keys()).some((key) => key.startsWith('github-events:processed:'))).toBe(false);
    expect(kv.store.get('github-events:last-event-id')).toBe('evt-push');
    expect(kv.store.get('github-events:repo-queued:acme/toolbox:')).toBe('1');
    expect(kv.putKeys.filter((key) => key.startsWith('github-rate-limit:'))).toHaveLength(2);
  });

  it('persists the newest processed event cursor before aborting on a later page rate limit', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const url = new URL(rawUrl);

      if (url.toString() === 'https://api.github.com/rate_limit') {
        return jsonResponse({
          resources: {
            core: {
              limit: 5000,
              remaining: 4900,
              used: 100,
              reset: resetAt,
            },
            graphql: {
              limit: 5000,
              remaining: 5000,
              used: 0,
              reset: resetAt,
            },
          },
        }, 200, {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4900',
          'x-ratelimit-used': '100',
          'x-ratelimit-reset': String(resetAt),
        });
      }

      if (url.pathname === '/events' && url.searchParams.get('page') === '1') {
        return jsonResponse([
          {
            id: 'evt-page1',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:01Z',
            repo: { name: 'Acme/Toolbox' },
          },
        ]);
      }

      if (url.pathname === '/events' && url.searchParams.get('page') === '2') {
        return jsonResponse(
          { message: 'rate limited' },
          403,
          {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-used': '5000',
            'x-ratelimit-reset': String(resetAt),
          }
        );
      }

      throw new Error(`Unexpected GitHub request: ${rawUrl}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => {
            sent.push(message);
          },
        },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_PAGES: '2',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_DISCOVERY_MIN_REST_REMAINING: '1',
        GITHUB_DISCOVERY_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
      } as never,
      {} as ExecutionContext
    );

    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Acme',
        repoName: 'Toolbox',
      }),
    ]);
    expect(kv.store.get('github-events:last-event-id')).toBe('evt-page1');
  });

  it('replays only the unfinished push events after a mid-page failure', async () => {
    const kv = new MemoryKv();
    const sentByRun: unknown[][] = [[], []];
    let runIndex = 0;
    let runSendAttempts = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const rawUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const url = new URL(rawUrl);

      if (url.toString() === 'https://api.github.com/rate_limit') {
        return jsonResponse({
          resources: {
            core: {
              limit: 5000,
              remaining: 4900,
              used: 100,
              reset: resetAt,
            },
            graphql: {
              limit: 5000,
              remaining: 5000,
              used: 0,
              reset: resetAt,
            },
          },
        }, 200, {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4900',
          'x-ratelimit-used': '100',
          'x-ratelimit-reset': String(resetAt),
        });
      }

      if (url.pathname === '/events') {
        return jsonResponse([
          {
            id: 'evt-first',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:02Z',
            repo: { name: 'Acme/Toolbox' },
          },
          {
            id: 'evt-second',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:01Z',
            repo: { name: 'Beta/Gadget' },
          },
        ]);
      }

      throw new Error(`Unexpected GitHub request: ${rawUrl}`);
    });

    const env = {
      KV: kv as never,
      INDEXING_QUEUE: {
        send: async (message: unknown) => {
          runSendAttempts += 1;
          if (runIndex === 0 && runSendAttempts === 2) {
            throw new Error('queue unavailable');
          }
          sentByRun[runIndex].push(message);
        },
      },
      GITHUB_TOKEN: 'token-a',
      GITHUB_EVENTS_MIN_REST_REMAINING: '1',
      GITHUB_EVENTS_REST_RESERVE: '0',
      GITHUB_DISCOVERY_MIN_REST_REMAINING: '1',
      GITHUB_DISCOVERY_REST_RESERVE: '0',
      GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
    } as never;

    await expect(githubEventsWorker.scheduled(
      {} as ScheduledController,
      env,
      {} as ExecutionContext
    )).rejects.toThrow('queue unavailable');

    kv.store.delete('github-events:repo-queued:acme/toolbox:');
    runIndex = 1;
    runSendAttempts = 0;

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      env,
      {} as ExecutionContext
    );

    expect(sentByRun[0]).toEqual([
      expect.objectContaining({
        repoOwner: 'Acme',
        repoName: 'Toolbox',
      }),
    ]);
    expect(sentByRun[1]).toEqual([
      expect.objectContaining({
        repoOwner: 'Beta',
        repoName: 'Gadget',
      }),
    ]);
    expect(kv.store.get('github-events:last-event-id')).toBe('evt-first');
    expect(kv.store.has('github-events:event-replay-state')).toBe(false);
  });
});
