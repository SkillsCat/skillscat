import { describe, expect, it } from 'vitest';
import { runRequestSecurity } from '../src/lib/server/security/request';

class MemoryKV {
  private store = new Map<string, string>();

  gets = 0;
  puts = 0;

  async get(key: string): Promise<string | null> {
    this.gets += 1;
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.puts += 1;
    this.store.set(key, value);
  }
}

function createEvent(options: {
  pathname: string;
  routeId: string;
  method?: string;
  userAgent?: string;
  ip?: string;
  kv: MemoryKV;
}): Parameters<typeof runRequestSecurity>[0] {
  const url = new URL(`https://skills.cat${options.pathname}`);
  const headers = new Headers({
    'cf-connecting-ip': options.ip ?? '198.51.100.10',
  });

  if (options.userAgent) {
    headers.set('user-agent', options.userAgent);
  }

  return {
    url,
    request: new Request(url, {
      method: options.method ?? 'GET',
      headers,
    }),
    platform: {
      env: {
        KV: options.kv,
      },
    },
    route: { id: options.routeId },
  } as never;
}

describe('request security rate limiting', () => {
  it('rate limits private D1-heavy reads that are hard to cache', async () => {
    const kv = new MemoryKV();

    const allowedRoutes = [
      {
        pathname: '/api/orgs/acme',
        routeId: '/api/orgs/[slug]',
      },
      {
        pathname: '/api/favorites',
        routeId: '/api/favorites',
      },
      {
        pathname: '/api/user/skills',
        routeId: '/api/user/skills',
      },
    ];

    for (const route of allowedRoutes) {
      for (let index = 0; index < 300; index += 1) {
        const response = await runRequestSecurity(createEvent({
          pathname: route.pathname,
          routeId: route.routeId,
          kv,
        }));

        expect(response).toBeNull();
      }
    }

    const blocked = await runRequestSecurity(createEvent({
      pathname: '/api/orgs/acme',
      routeId: '/api/orgs/[slug]',
      kv,
    }));

    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('x-ratelimit-limit')).toBe('300');
    expect(kv.gets).toBeGreaterThan(0);
    expect(kv.puts).toBeGreaterThan(0);
  });

  it('does not consume KV for cache-backed registry and tool reads', async () => {
    const kv = new MemoryKV();

    const routes = [
      {
        pathname: '/registry/search/tool?q=test',
        routeId: '/registry/search/tool',
        userAgent: 'OpenClaw/1.4.0',
      },
      {
        pathname: '/api/tools/search-skills?q=test',
        routeId: '/api/tools/search-skills',
        userAgent: 'skillscat-cli/1.0',
      },
      {
        pathname: '/api/skills/testowner%2Fdemo/files',
        routeId: '/api/skills/[slug]/files',
        userAgent: 'OpenClaw/1.4.0',
      },
    ];

    for (const route of routes) {
      for (let index = 0; index < 5; index += 1) {
        const response = await runRequestSecurity(createEvent({
          pathname: route.pathname,
          routeId: route.routeId,
          userAgent: route.userAgent,
          kv,
        }));

        expect(response).toBeNull();
      }
    }

    expect(kv.gets).toBe(0);
    expect(kv.puts).toBe(0);
  });
});
