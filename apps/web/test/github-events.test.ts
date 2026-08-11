import { afterEach, describe, expect, it, vi } from 'vitest';

import githubEventsWorker from '../workers/github-events';
import {
  buildRepoQueuedDedupIdentity,
  computeAllowedSearchPages,
  loadKnownGitHubRepoIdentities,
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

function readRepoQueuedWindow(kv: MemoryKv): Record<string, number> {
  const raw = kv.store.get('github-events:repo-queued-window');
  if (!raw) return {};
  const parsed = JSON.parse(raw) as { entries?: Record<string, number> };
  return parsed.entries || {};
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

  it('chunks known-repository lookups below the D1 parameter limit and checks legacy skills', async () => {
    const bindingCounts: number[] = [];
    const db = {
      prepare(sql: string) {
        expect(sql).toContain('skill_sources_repo_path_unique');
        expect(sql).toContain('skills_repo_path_unique');
        return {
          bind: (...bindings: string[]) => {
            bindingCounts.push(bindings.length);
            return {
              all: async () => ({
                results: Array.from({ length: bindings.length / 2 }, (_, index) => ({
                  repoOwner: bindings[index * 2],
                  repoName: bindings[(index * 2) + 1],
                })),
              }),
            };
          },
        };
      },
    } as unknown as D1Database;
    const repos = Array.from({ length: 61 }, (_, index) => ({
      owner: `Owner${index}`,
      name: `Repo${index}`,
    }));

    const known = await loadKnownGitHubRepoIdentities(db, repos);

    expect(bindingCounts).toEqual([100, 22]);
    expect(known.size).toBe(61);
    expect(known.has('owner60/repo60')).toBe(true);
  });

  it('does not consume the anonymous GitHub API quota when no token is configured', async () => {
    const kv = new MemoryKv();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('GitHub must not be called without a managed token')
    );
    const send = vi.fn(async () => undefined);

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        DB: {} as D1Database,
        KV: kv as never,
        INDEXING_QUEUE: { send },
        GITHUB_SEARCH_DISCOVERY_ENABLED: '1',
      } as never,
      {} as ExecutionContext
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
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
        GITHUB_EVENTS_KNOWN_REPOS_ONLY: '0',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
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
    expect(readRepoQueuedWindow(kv)).toHaveProperty('acme/toolbox:');
    expect(kv.putKeys.filter((key) => key.startsWith('github-rate-limit:'))).toHaveLength(2);
  });

  it('queues PushEvents only for repositories already known to the registry', async () => {
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
            core: { limit: 5000, remaining: 4900, used: 100, reset: resetAt },
            graphql: { limit: 5000, remaining: 5000, used: 0, reset: resetAt },
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
            id: 'evt-known',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:02Z',
            repo: { name: 'Acme/Known' },
            payload: {
              head: 'a'.repeat(40),
              ref: 'refs/heads/main',
            },
          },
          {
            id: 'evt-unknown',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:01Z',
            repo: { name: 'Noise/Unrelated' },
            payload: {},
          },
        ]);
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const db = {
      prepare(sql: string) {
        expect(sql).toContain('skill_sources_repo_path_unique');
        expect(sql).toContain('skills_repo_path_unique');
        return {
          bind: (...bindings: unknown[]) => {
            expect(bindings).toEqual(['Acme', 'Known', 'Noise', 'Unrelated']);
            return {
              all: async () => ({
                results: [{ repoOwner: 'Acme', repoName: 'Known' }],
              }),
            };
          },
        };
      },
    } as unknown as D1Database;

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        DB: db,
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => sent.push(message),
        },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
      } as never,
      {} as ExecutionContext
    );

    expect(sent).toEqual([
      expect.objectContaining({
        repoOwner: 'Acme',
        repoName: 'Known',
        headSha: 'a'.repeat(40),
        gitRef: 'refs/heads/main',
      }),
    ]);
  });

  it('preserves completed event replay state without advancing the cursor on a later page rate limit', async () => {
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
        GITHUB_EVENTS_KNOWN_REPOS_ONLY: '0',
        GITHUB_EVENTS_PER_PAGE: '1',
        GITHUB_EVENTS_PAGES: '2',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
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
    expect(kv.store.get('github-events:last-event-id')).toBeUndefined();
    expect(JSON.parse(kv.store.get('github-events:event-replay-state') || '{}')).toEqual({
      baseLastEventId: null,
      processedPushEventIds: ['evt-page1'],
    });
  });

  it('continues queue-cap overflow on the next run before advancing the event cursor', async () => {
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
            core: { limit: 5000, remaining: 4900, used: 100, reset: resetAt },
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
            id: 'evt-newest',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:02Z',
            repo: { name: 'Acme/First' },
          },
          {
            id: 'evt-older',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:01Z',
            repo: { name: 'Beta/Second' },
          },
        ]);
      }

      throw new Error(`Unexpected GitHub request: ${rawUrl}`);
    });

    const env = {
      KV: kv as never,
      INDEXING_QUEUE: {
        send: async (message: unknown) => sent.push(message),
      },
      GITHUB_TOKEN: 'token-a',
      GITHUB_EVENTS_KNOWN_REPOS_ONLY: '0',
      GITHUB_EVENTS_MAX_QUEUED_REPOS: '1',
      GITHUB_EVENTS_MIN_REST_REMAINING: '1',
      GITHUB_EVENTS_REST_RESERVE: '0',
      GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
    } as never;

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      env,
      {} as ExecutionContext
    );

    expect(sent).toEqual([
      expect.objectContaining({ repoOwner: 'Acme', repoName: 'First' }),
    ]);
    expect(kv.store.get('github-events:last-event-id')).toBeUndefined();
    expect(kv.store.has('github-events:event-replay-state')).toBe(true);

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      env,
      {} as ExecutionContext
    );

    expect(sent).toEqual([
      expect.objectContaining({ repoOwner: 'Acme', repoName: 'First' }),
      expect.objectContaining({ repoOwner: 'Beta', repoName: 'Second' }),
    ]);
    expect(kv.store.get('github-events:last-event-id')).toBe('evt-newest');
    expect(kv.store.has('github-events:event-replay-state')).toBe(false);
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
      GITHUB_EVENTS_KNOWN_REPOS_ONLY: '0',
      GITHUB_EVENTS_MIN_REST_REMAINING: '1',
      GITHUB_EVENTS_REST_RESERVE: '0',
      GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
    } as never;

    await expect(githubEventsWorker.scheduled(
      {} as ScheduledController,
      env,
      {} as ExecutionContext
    )).rejects.toThrow('queue unavailable');

    const repoQueuedWindow = readRepoQueuedWindow(kv);
    delete repoQueuedWindow['acme/toolbox:'];
    kv.store.set('github-events:repo-queued-window', JSON.stringify({ entries: repoQueuedWindow }));
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
