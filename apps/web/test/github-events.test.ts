import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import githubEventsWorker from '../workers/github-events';
import {
  buildRepoQueuedDedupIdentity,
  computeAllowedSearchPages,
  extractGitHubReposFromBskyPost,
  extractGitHubReposFromText,
  extractGitHubReposFromTweet,
  extractReposFromGitHubTopicsHtml,
  getAwesomeListsDiscoveryConfig,
  getBskySearchDiscoveryConfig,
  getGithubTopicsDiscoveryConfig,
  loadKnownGitHubRepoIdentities,
  parseGitHubRepoUrl,
  processAwesomeListsDiscovery,
  processBskySearchDiscovery,
  processGithubTopicsDiscovery,
  reserveXSearchRequest,
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
  it('parses canonical GitHub repository URLs from X links', () => {
    expect(parseGitHubRepoUrl('https://github.com/Acme/Toolbox')).toEqual({
      owner: 'Acme',
      name: 'Toolbox',
    });
    expect(parseGitHubRepoUrl('https://github.com/Acme/Toolbox.git/')).toEqual({
      owner: 'Acme',
      name: 'Toolbox',
    });
    expect(parseGitHubRepoUrl('https://github.com/Acme/Toolbox?utm_source=x')).toEqual({
      owner: 'Acme',
      name: 'Toolbox',
    });
  });

  it('rejects non-repository GitHub URLs and unrelated hosts', () => {
    expect(parseGitHubRepoUrl(undefined)).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/Acme')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/Acme/Toolbox/issues/1')).toBeNull();
    expect(parseGitHubRepoUrl('https://github.com/Acme/Toolbox/pull/2')).toBeNull();
    expect(parseGitHubRepoUrl('https://gitlab.com/Acme/Toolbox')).toBeNull();
    expect(parseGitHubRepoUrl('ftp://github.com/Acme/Toolbox')).toBeNull();
    expect(parseGitHubRepoUrl('not a URL')).toBeNull();
  });

  it('extracts, deduplicates, and normalizes repository links from a tweet', () => {
    const repos = extractGitHubReposFromTweet({
      id: 'tweet-1',
      text: 'New skills',
      entities: {
        urls: [
          { url: 'https://t.co/first', expanded_url: 'https://github.com/Acme/Toolbox' },
          { url: 'https://github.com/acme/toolbox' },
          { url: 'https://github.com/Acme/Toolbox/issues/1' },
          { url: 'https://example.com/skills' },
          { url: 'https://t.co/unexpanded' },
          { url: 'https://github.com/Other/Skill.git' },
        ],
      },
    });

    expect(repos).toEqual([
      { owner: 'Acme', name: 'Toolbox' },
      { owner: 'Other', name: 'Skill' },
    ]);
  });

  it('handles tweets without URL entities', () => {
    expect(extractGitHubReposFromTweet({ id: 'tweet-empty', text: 'No links' })).toEqual([]);
    expect(extractGitHubReposFromTweet({ id: 'tweet-empty', entities: { urls: [] } })).toEqual([]);
  });

  it('enforces independent daily and monthly X request budgets', async () => {
    const kv = new MemoryKv();
    const now = Date.parse('2026-08-28T00:00:00Z');
    const dailyBudget = { maxRequestsPerDay: 2, maxRequestsPerMonth: 10 };

    expect(await reserveXSearchRequest(kv as unknown as KVNamespace, dailyBudget, now)).toBe(true);
    expect(await reserveXSearchRequest(kv as unknown as KVNamespace, dailyBudget, now)).toBe(true);
    expect(await reserveXSearchRequest(kv as unknown as KVNamespace, dailyBudget, now)).toBe(false);
    const monthlyBudget = { maxRequestsPerDay: 10, maxRequestsPerMonth: 2 };
    expect(await reserveXSearchRequest(
      kv as unknown as KVNamespace,
      monthlyBudget,
      Date.parse('2026-09-01T00:00:00Z')
    )).toBe(true);
    expect(await reserveXSearchRequest(
      kv as unknown as KVNamespace,
      monthlyBudget,
      Date.parse('2026-09-02T00:00:00Z')
    )).toBe(true);
    expect(await reserveXSearchRequest(
      kv as unknown as KVNamespace,
      monthlyBudget,
      Date.parse('2026-09-03T00:00:00Z')
    )).toBe(false);
  });

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
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
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
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
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

  it('uses a short event dedupe window so later pushes refresh an active repository', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00Z'));
    try {
      const kv = new MemoryKv();
      const sent: unknown[] = [];
      let run = 0;
      const resetAt = Math.floor(Date.now() / 1000) + 600;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url === 'https://api.github.com/rate_limit') {
          return rateLimitResponse(100, resetAt);
        }
        if (url.startsWith('https://api.github.com/events?')) {
          return jsonResponse(run === 0
            ? [{ id: 'evt-push-1', type: 'PushEvent', created_at: '2026-04-18T00:00:01Z', repo: { name: 'Acme/Toolbox' } }]
            : [
                { id: 'evt-push-2', type: 'PushEvent', created_at: '2026-04-18T00:06:01Z', repo: { name: 'Acme/Toolbox' } },
                { id: 'evt-push-1', type: 'PushEvent', created_at: '2026-04-18T00:00:01Z', repo: { name: 'Acme/Toolbox' } },
              ]);
        }
        throw new Error(`Unexpected GitHub request: ${url}`);
      });

      const env = {
        KV: kv as never,
        INDEXING_QUEUE: { send: async (message: unknown) => sent.push(message) },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_KNOWN_REPOS_ONLY: '0',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_EVENT_QUEUE_DEDUP_TTL_SECONDS: '300',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
      } as never;

      await githubEventsWorker.scheduled({} as ScheduledController, env, {} as ExecutionContext);
      run = 1;
      vi.setSystemTime(new Date('2026-04-18T00:06:00Z'));
      await githubEventsWorker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

      expect(sent).toHaveLength(2);
      expect(kv.store.get('github-events:last-event-id')).toBe('evt-push-2');
    } finally {
      vi.useRealTimers();
    }
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
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
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
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
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
      GITHUB_SEARCH_BACKFILL_ENABLED: '0',
      GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
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
      GITHUB_SEARCH_BACKFILL_ENABLED: '0',
      GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
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

// 真实 github.com/search 仓库结果页(2026-08 curl 抓取),只保留嵌入 JSON script。
const searchFixtureHtml = readFileSync(
  fileURLToPath(new URL('./fixtures/github-search-repositories.html', import.meta.url)),
  'utf8'
);

function rateLimitResponse(searchRemaining: number, resetAt: number): Response {
  return jsonResponse({
    resources: {
      core: { limit: 5000, remaining: 4900, used: 100, reset: resetAt },
      search: { limit: 30, remaining: searchRemaining, used: 30 - searchRemaining, reset: resetAt },
      graphql: { limit: 5000, remaining: 5000, used: 0, reset: resetAt },
    },
  }, 200, {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4900',
    'x-ratelimit-used': '100',
    'x-ratelimit-reset': String(resetAt),
  });
}

function requestUrl(input: unknown): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;
}

describe('github-events code search backfill', () => {
  it('shares the current tick page budget between head discovery and backfill', async () => {
    const kv = new MemoryKv();
    const searchUrls: string[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      sha: `${String(index).padStart(2, '0')}${'a'.repeat(38)}`,
      path: 'SKILL.md',
      repository: { full_name: `Acme/Head${index}` },
    }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url === 'https://api.github.com/rate_limit') return rateLimitResponse(10, resetAt);
      if (url.startsWith('https://api.github.com/events?')) return jsonResponse([]);
      if (url.startsWith('https://api.github.com/search/code?')) {
        searchUrls.push(url);
        return jsonResponse({ items: new URL(url).searchParams.get('q')?.includes('created:') ? [] : fullPage });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: { send: async () => undefined },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '1',
        GITHUB_SEARCH_DISCOVERY_INTERVAL_SECONDS: '1',
        GITHUB_SEARCH_DISCOVERY_PAGES: '3',
        GITHUB_SEARCH_DISCOVERY_PER_PAGE: '100',
        GITHUB_SEARCH_BACKFILL_ENABLED: '1',
        GITHUB_SEARCH_BACKFILL_INTERVAL_SECONDS: '1',
        GITHUB_SEARCH_BACKFILL_MAX_PAGES: '10',
        GITHUB_SEARCH_BACKFILL_RESERVE: '0',
        GITHUB_SEARCH_BACKFILL_MIN_REMAINING: '1',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
      } as never,
      {} as ExecutionContext
    );

    expect(searchUrls).toHaveLength(3);
    expect(searchUrls.some((url) => new URL(url).searchParams.get('q')?.includes('created:'))).toBe(false);
  });

  it('backfills one created-date slice per tick and advances the cursor', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const searchUrls: string[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url === 'https://api.github.com/rate_limit') {
        return rateLimitResponse(10, resetAt);
      }
      if (url.startsWith('https://api.github.com/events?')) {
        return jsonResponse([]);
      }
      if (url.startsWith('https://api.github.com/search/code?')) {
        searchUrls.push(url);
        return jsonResponse({
          items: [
            {
              sha: 'b'.repeat(40),
              path: 'SKILL.md',
              repository: { full_name: 'Acme/Backfilled' },
            },
          ],
        });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => sent.push(message),
        },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '1',
        GITHUB_SEARCH_BACKFILL_INTERVAL_SECONDS: '1',
        GITHUB_SEARCH_BACKFILL_START_DATE: '2025-03-05',
      } as never,
      {} as ExecutionContext
    );

    expect(searchUrls).toHaveLength(1);
    expect(new URL(searchUrls[0]).searchParams.get('q')).toBe(
      'filename:SKILL.md created:2025-03-05..2025-03-05'
    );
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Acme',
        repoName: 'Backfilled',
        discoverySource: 'github-code-search',
      }),
    ]);
    expect(kv.store.get('github-events:code-search:backfill-cursor')).toBe(
      JSON.stringify({ date: '2025-03-06' })
    );
  });

  it('wraps the backfill cursor back to the start date after reaching today', async () => {
    const kv = new MemoryKv();
    const searchUrls: string[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    const today = new Date().toISOString().slice(0, 10);
    kv.store.set('github-events:code-search:backfill-cursor', JSON.stringify({ date: today }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url === 'https://api.github.com/rate_limit') {
        return rateLimitResponse(10, resetAt);
      }
      if (url.startsWith('https://api.github.com/events?')) {
        return jsonResponse([]);
      }
      if (url.startsWith('https://api.github.com/search/code?')) {
        searchUrls.push(url);
        return jsonResponse({ items: [] });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: { send: async () => undefined },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '1',
        GITHUB_SEARCH_BACKFILL_INTERVAL_SECONDS: '1',
        GITHUB_SEARCH_BACKFILL_START_DATE: '2025-01-02',
      } as never,
      {} as ExecutionContext
    );

    expect(searchUrls).toHaveLength(1);
    expect(new URL(searchUrls[0]).searchParams.get('q')).toBe(
      'filename:SKILL.md created:2025-01-02..2025-01-02'
    );
    expect(kv.store.get('github-events:code-search:backfill-cursor')).toBe(
      JSON.stringify({ date: '2025-01-03' })
    );
  });

  it('skips the backfill when the search budget is below the configured minimum', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const searchUrls: string[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url === 'https://api.github.com/rate_limit') {
        return rateLimitResponse(1, resetAt);
      }
      if (url.startsWith('https://api.github.com/events?')) {
        return jsonResponse([]);
      }
      if (url.startsWith('https://api.github.com/search/code?')) {
        searchUrls.push(url);
        return jsonResponse({ items: [] });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => sent.push(message),
        },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '1',
        GITHUB_SEARCH_BACKFILL_INTERVAL_SECONDS: '1',
        GITHUB_SEARCH_BACKFILL_MIN_REMAINING: '5',
      } as never,
      {} as ExecutionContext
    );

    expect(searchUrls).toHaveLength(0);
    expect(sent).toEqual([]);
    expect(kv.store.has('github-events:code-search:backfill-cursor')).toBe(false);
  });
});

describe('github-events repo queue dedup TTL', () => {
  it('honors GITHUB_REPO_QUEUE_DEDUP_TTL_SECONDS for the queue window entries', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const resetAt = Math.floor(Date.now() / 1000) + 600;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url === 'https://api.github.com/rate_limit') {
        return rateLimitResponse(10, resetAt);
      }
      if (url.startsWith('https://api.github.com/events?')) {
        return jsonResponse([
          {
            id: 'evt-ttl',
            type: 'PushEvent',
            created_at: '2026-04-18T00:00:01Z',
            repo: { name: 'Acme/Toolbox' },
          },
        ]);
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const beforeMs = Date.now();
    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => sent.push(message),
        },
        GITHUB_TOKEN: 'token-a',
        GITHUB_EVENTS_KNOWN_REPOS_ONLY: '0',
        GITHUB_EVENTS_MIN_REST_REMAINING: '1',
        GITHUB_EVENTS_REST_RESERVE: '0',
        GITHUB_EVENT_QUEUE_DEDUP_TTL_SECONDS: '3600',
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_REPO_QUEUE_DEDUP_TTL_SECONDS: '3600',
      } as never,
      {} as ExecutionContext
    );

    expect(sent).toHaveLength(1);
    const window = readRepoQueuedWindow(kv);
    const expiresAt = window['acme/toolbox:'];
    expect(expiresAt).toBeGreaterThanOrEqual(beforeMs + 3600_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000);
  });
});

describe('github-events HTML repo search discovery', () => {
  it('enqueues HTML search candidates only when SKILL.md exists at the default branch HEAD', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const skillMdChecks: string[] = [];
    const searchRequests: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url.startsWith('https://github.com/search?')) {
        searchRequests.push(url);
        return new Response(searchFixtureHtml, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      const rawMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/HEAD\/SKILL\.md$/);
      if (rawMatch) {
        skillMdChecks.push(`${rawMatch[1]}/${rawMatch[2]}`);
        // 只有第一个候选仓库存在 SKILL.md,其余按 awesome-list 类处理(404)。
        if (rawMatch[1] === 'Punky971210' && rawMatch[2] === 'dsh-punky-swarm') {
          return new Response('# skill', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => sent.push(message),
        },
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '1',
        GITHUB_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS: '1',
        GITHUB_HTML_SEARCH_QUERIES: 'SKILL.md in:readme',
        GITHUB_HTML_SEARCH_PAGES: '3',
      } as never,
      {} as ExecutionContext
    );

    expect(skillMdChecks.length).toBe(10);
    expect(searchRequests).toHaveLength(3);
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Punky971210',
        repoName: 'dsh-punky-swarm',
        discoverySource: 'github-repo-search-html',
      }),
    ]);
    expect((sent[0] as { skillPath?: string }).skillPath).toBeUndefined();
    expect(readRepoQueuedWindow(kv)).toHaveProperty('punky971210/dsh-punky-swarm:');
  });

  it('skips HTML discovery gracefully when the search page schema changes', async () => {
    const kv = new MemoryKv();
    const sent: unknown[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url.startsWith('https://github.com/search?')) {
        return new Response('<html><body>captcha</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.includes('/raw/HEAD/SKILL.md')) {
        throw new Error('SKILL.md check must not run when the search page cannot be parsed');
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await githubEventsWorker.scheduled(
      {} as ScheduledController,
      {
        KV: kv as never,
        INDEXING_QUEUE: {
          send: async (message: unknown) => sent.push(message),
        },
        GITHUB_SEARCH_DISCOVERY_ENABLED: '0',
        GITHUB_SEARCH_BACKFILL_ENABLED: '0',
        GITHUB_HTML_SEARCH_DISCOVERY_ENABLED: '1',
        GITHUB_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS: '1',
      } as never,
      {} as ExecutionContext
    );

    expect(sent).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});

function seedDiscoveryRunLock(kv: MemoryKv, token: string = 'test-lock'): void {
  const now = Date.now();
  kv.store.set('github-discovery:run-lock', JSON.stringify({
    token,
    acquiredAtEpochMs: now,
    expiresAtEpochMs: now + 240_000,
  }));
}

function freshDedupeState() {
  return {
    recentUntilByIdentity: new Map<string, number>(),
    queuedInRun: new Set<string>(),
    dirty: false,
  } as never;
}

function knownReposDb(known: Array<[string, string]>): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({
          results: known.map(([repoOwner, repoName]) => ({ repoOwner, repoName })),
        }),
      }),
    }),
  } as unknown as D1Database;
}

describe('github-events topics discovery', () => {
  it('extracts two-segment repository links from a topics page and skips reserved paths', () => {
    const html = [
      '<a href="/Acme/Toolbox">repo</a>',
      '<a href="/acme/toolbox">duplicate</a>',
      '<a href="/Other/Skill.git">repo</a>',
      '<a href="/topics/claude-skills">reserved</a>',
      '<a href="/login/oauth">reserved</a>',
      '<a href="/marketplace/actions">reserved</a>',
      '<a href="/explore">one segment</a>',
      '<a href="/Acme/Toolbox/issues">three segments</a>',
      '<a href="/Acme/Bad%20Name">invalid chars</a>',
    ].join('');

    expect(extractReposFromGitHubTopicsHtml(html)).toEqual([
      { owner: 'Acme', name: 'Toolbox' },
      { owner: 'Other', name: 'Skill' },
    ]);
  });

  it('parses topics discovery config defaults and overrides', () => {
    const defaults = getGithubTopicsDiscoveryConfig({} as never);
    expect(defaults).toEqual({
      enabled: true,
      topics: ['claude-code-skill', 'claude-skills', 'agent-skills'],
      pagesPerTopic: 2,
      intervalSeconds: 3600,
      maxQueuedRepos: 50,
      cronIntervalSeconds: 300,
    });

    const overrides = getGithubTopicsDiscoveryConfig({
      GITHUB_TOPICS_ENABLED: '0',
      GITHUB_TOPICS_LIST: 'topic-a, topic-b',
      GITHUB_TOPICS_PAGES_PER_TOPIC: '9',
      GITHUB_TOPICS_INTERVAL_SECONDS: '60',
      GITHUB_TOPICS_MAX_QUEUED_REPOS: '5',
    } as never);
    expect(overrides.enabled).toBe(false);
    expect(overrides.topics).toEqual(['topic-a', 'topic-b']);
    expect(overrides.pagesPerTopic).toBe(5);
    expect(overrides.intervalSeconds).toBe(60);
    expect(overrides.maxQueuedRepos).toBe(5);
  });

  it('skips topics discovery when disabled without fetching', async () => {
    const kv = new MemoryKv();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const send = vi.fn(async () => undefined);

    const result = await processGithubTopicsDiscovery(
      {
        KV: kv as never,
        INDEXING_QUEUE: { send },
        GITHUB_TOPICS_ENABLED: '0',
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 0, queued: 0, pagesFetched: 0, skippedReason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('queues no repositories when topics pages contain no repo links', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const send = vi.fn(async () => undefined);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith('https://github.com/topics/')) {
        return new Response('<a href="/topics/other">reserved</a>', { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await processGithubTopicsDiscovery(
      {
        KV: kv as never,
        DB: knownReposDb([]),
        INDEXING_QUEUE: { send },
        GITHUB_TOPICS_LIST: 'claude-code-skill',
        GITHUB_TOPICS_PAGES_PER_TOPIC: '1',
        GITHUB_TOPICS_INTERVAL_SECONDS: '1',
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 0, queued: 0, pagesFetched: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it('queues only unknown topics candidates within the dedupe window', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const sent: unknown[] = [];
    const state = {
      recentUntilByIdentity: new Map<string, number>(),
      queuedInRun: new Set<string>(),
      dirty: false,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith('https://github.com/topics/')) {
        return new Response(
          '<a href="/Known/Repo">k</a><a href="/Fresh/Repo">f</a><a href="/Recently/Queued">r</a>',
          { status: 200 }
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const nowMs = Date.now();
    state.recentUntilByIdentity.set('recently/queued:', nowMs + 60_000);

    const result = await processGithubTopicsDiscovery(
      {
        KV: kv as never,
        DB: knownReposDb([['Known', 'Repo']]),
        INDEXING_QUEUE: { send: async (message: unknown) => sent.push(message) },
        GITHUB_TOPICS_LIST: 'claude-code-skill',
        GITHUB_TOPICS_PAGES_PER_TOPIC: '1',
        GITHUB_TOPICS_INTERVAL_SECONDS: '1',
      } as never,
      state as never,
      'test-lock',
      nowMs
    );

    expect(result).toEqual({ scanned: 3, queued: 1, pagesFetched: 1 });
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Fresh',
        repoName: 'Repo',
        discoverySource: 'github-topics',
      }),
    ]);
    expect(state.queuedInRun.has('fresh/repo:')).toBe(true);
  });
});

describe('github-events awesome lists discovery', () => {
  it('extracts repository links from arbitrary markdown text', () => {
    const text = [
      '- [Toolbox](https://github.com/Acme/Toolbox) - skills',
      '- duplicate https://github.com/acme/toolbox',
      '- issues link https://github.com/Acme/Toolbox/issues/1',
      '- other host https://gitlab.com/Acme/Toolbox',
      '- dot git https://github.com/Other/Skill.git',
    ].join('\n');

    expect(extractGitHubReposFromText(text)).toEqual([
      { owner: 'Acme', name: 'Toolbox' },
      { owner: 'Other', name: 'Skill' },
    ]);
  });

  it('parses awesome lists config defaults and overrides', () => {
    const defaults = getAwesomeListsDiscoveryConfig({} as never);
    expect(defaults.enabled).toBe(true);
    expect(defaults.urls).toEqual([
      'https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md',
    ]);
    expect(defaults.intervalSeconds).toBe(86400);
    expect(defaults.maxQueuedRepos).toBe(50);
    expect(defaults.maxLists).toBe(5);

    const overrides = getAwesomeListsDiscoveryConfig({
      AWESOME_LISTS_ENABLED: '0',
      AWESOME_LIST_URLS: 'https://a.example/one.md, https://a.example/two.md, https://a.example/three.md',
      AWESOME_LISTS_MAX_LISTS: '2',
      AWESOME_LISTS_INTERVAL_SECONDS: '3600',
      AWESOME_LISTS_MAX_QUEUED_REPOS: '10',
    } as never);
    expect(overrides.enabled).toBe(false);
    expect(overrides.urls).toEqual(['https://a.example/one.md', 'https://a.example/two.md']);
    expect(overrides.intervalSeconds).toBe(3600);
    expect(overrides.maxQueuedRepos).toBe(10);
  });

  it('skips awesome lists discovery when disabled without fetching', async () => {
    const kv = new MemoryKv();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const send = vi.fn(async () => undefined);

    const result = await processAwesomeListsDiscovery(
      {
        KV: kv as never,
        INDEXING_QUEUE: { send },
        AWESOME_LISTS_ENABLED: '0',
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 0, queued: 0, listsFetched: 0, skippedReason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('reports request_failed when every awesome list fetch fails', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const send = vi.fn(async () => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 404 }));

    const result = await processAwesomeListsDiscovery(
      {
        KV: kv as never,
        DB: knownReposDb([]),
        INDEXING_QUEUE: { send },
        AWESOME_LIST_URLS: 'https://example.com/awesome.md',
        AWESOME_LISTS_INTERVAL_SECONDS: '1',
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 0, queued: 0, listsFetched: 0, skippedReason: 'request_failed' });
    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('queues unknown repositories found in awesome list markdown', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const sent: unknown[] = [];
    const markdown = [
      '# Awesome',
      '- [Known](https://github.com/Known/Repo)',
      '- [Fresh](https://github.com/Fresh/Repo) - new skills',
    ].join('\n');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url === 'https://example.com/awesome.md') {
        return new Response(markdown, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await processAwesomeListsDiscovery(
      {
        KV: kv as never,
        DB: knownReposDb([['Known', 'Repo']]),
        INDEXING_QUEUE: { send: async (message: unknown) => sent.push(message) },
        AWESOME_LIST_URLS: 'https://example.com/awesome.md',
        AWESOME_LISTS_INTERVAL_SECONDS: '1',
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 2, queued: 1, listsFetched: 1 });
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Fresh',
        repoName: 'Repo',
        discoverySource: 'awesome-lists',
      }),
    ]);
  });
});

describe('github-events bluesky search discovery', () => {
  it('extracts repository links from post text and link facets', () => {
    const repos = extractGitHubReposFromBskyPost({
      uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
      record: {
        text: 'new SKILL.md at https://github.com/Acme/Toolbox and duplicate https://github.com/acme/toolbox',
        facets: [
          {
            features: [
              { $type: 'app.bsky.richtext.facet#link', uri: 'https://github.com/Facet/Repo' },
              { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:someone' },
            ],
          },
        ],
      },
    });

    expect(repos).toEqual([
      { owner: 'Acme', name: 'Toolbox' },
      { owner: 'Facet', name: 'Repo' },
    ]);
    expect(extractGitHubReposFromBskyPost({ uri: 'at://empty', record: { text: 'no links' } })).toEqual([]);
  });

  it('parses bluesky search config defaults and overrides', () => {
    const defaults = getBskySearchDiscoveryConfig({} as never);
    expect(defaults).toEqual({
      enabled: false,
      query: '"SKILL.md" github',
      intervalSeconds: 900,
      maxResults: 50,
      maxQueuedRepos: 50,
      cronIntervalSeconds: 300,
    });

    const overrides = getBskySearchDiscoveryConfig({
      BSKY_SEARCH_ENABLED: '1',
      BSKY_SEARCH_QUERY: 'agent skills',
      BSKY_SEARCH_INTERVAL_SECONDS: '60',
      BSKY_SEARCH_MAX_RESULTS: '500',
      BSKY_SEARCH_MAX_QUEUED_REPOS: '10',
    } as never);
    expect(overrides.enabled).toBe(true);
    expect(overrides.query).toBe('agent skills');
    expect(overrides.intervalSeconds).toBe(60);
    expect(overrides.maxResults).toBe(100);
    expect(overrides.maxQueuedRepos).toBe(10);
  });

  it('skips bluesky search when disabled without fetching', async () => {
    const kv = new MemoryKv();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const send = vi.fn(async () => undefined);

    const result = await processBskySearchDiscovery(
      {
        KV: kv as never,
        INDEXING_QUEUE: { send },
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 0, queued: 0, posts: 0, skippedReason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('maps bluesky 403 responses to auth_required without advancing the cursor', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const send = vi.fn(async () => undefined);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?')) {
        return new Response('forbidden', { status: 403 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await processBskySearchDiscovery(
      {
        KV: kv as never,
        INDEXING_QUEUE: { send },
        BSKY_SEARCH_ENABLED: '1',
        BSKY_SEARCH_INTERVAL_SECONDS: '1',
      } as never,
      freshDedupeState(),
      'test-lock'
    );

    expect(result).toEqual({ scanned: 0, queued: 0, posts: 0, skippedReason: 'auth_required' });
    expect(send).not.toHaveBeenCalled();
    expect(kv.store.has('github-events:bsky-search:since')).toBe(false);
  });

  it('queues unknown repositories and advances the since cursor on success', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const sent: unknown[] = [];
    const nowMs = Date.parse('2026-08-28T12:00:00Z');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.startsWith('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?')) {
        return jsonResponse({
          posts: [
            {
              uri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
              record: { text: 'try https://github.com/Fresh/BskyRepo' },
            },
            {
              uri: 'at://did:plc:abc/app.bsky.feed.post/known',
              record: {
                text: 'known repo',
                facets: [
                  { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://github.com/Known/Repo' }] },
                ],
              },
            },
            { uri: 'at://did:plc:abc/app.bsky.feed.post/none', record: { text: 'no links here' } },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await processBskySearchDiscovery(
      {
        KV: kv as never,
        DB: knownReposDb([['Known', 'Repo']]),
        INDEXING_QUEUE: { send: async (message: unknown) => sent.push(message) },
        BSKY_SEARCH_ENABLED: '1',
        BSKY_SEARCH_INTERVAL_SECONDS: '1',
      } as never,
      freshDedupeState(),
      'test-lock',
      nowMs
    );

    expect(result).toEqual({ scanned: 2, queued: 1, posts: 3 });
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'check_skill',
        repoOwner: 'Fresh',
        repoName: 'BskyRepo',
        discoverySource: 'bluesky-search',
        discoveryFingerprint: 'bsky:at://did:plc:abc/app.bsky.feed.post/xyz',
      }),
    ]);
    expect(kv.store.get('github-events:bsky-search:since')).toBe('2026-08-28T12:00:00.000Z');
  });

  it('advances the since cursor even when no post yields a repository', async () => {
    const kv = new MemoryKv();
    seedDiscoveryRunLock(kv);
    const send = vi.fn(async () => undefined);
    const nowMs = Date.parse('2026-08-28T13:00:00Z');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ posts: [] }));

    const result = await processBskySearchDiscovery(
      {
        KV: kv as never,
        INDEXING_QUEUE: { send },
        BSKY_SEARCH_ENABLED: '1',
        BSKY_SEARCH_INTERVAL_SECONDS: '1',
      } as never,
      freshDedupeState(),
      'test-lock',
      nowMs
    );

    expect(result).toEqual({ scanned: 0, queued: 0, posts: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(kv.store.get('github-events:bsky-search:since')).toBe('2026-08-28T13:00:00.000Z');
  });
});
