import { describe, expect, it } from 'vitest';
import { runRequestSecurity } from '../src/lib/server/security/request';
import { SkillscatStateDurableObject } from '../src/lib/server/state/durable-object';

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

class MemoryDurableObjectStorage {
  private store = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
}

class MemoryStateNamespace {
  private objects = new Map<string, SkillscatStateDurableObject>();

  fetches = 0;

  idFromName(name: string): DurableObjectId {
    return name as never;
  }

  get(id: DurableObjectId): DurableObjectStub {
    const objectName = id as never as string;
    let object = this.objects.get(objectName);
    if (!object) {
      object = new SkillscatStateDurableObject({
        storage: new MemoryDurableObjectStorage(),
      } as never);
      this.objects.set(objectName, object);
    }

    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        this.fetches += 1;
        return object.fetch(new Request(input, init));
      },
    } as never;
  }
}

function createEvent(options: {
  pathname: string;
  routeId: string;
  method?: string;
  userAgent?: string;
  ip?: string;
  kv: MemoryKV;
  stateDo?: MemoryStateNamespace;
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
        STATE_DO: options.stateDo,
      },
    },
    route: { id: options.routeId },
  } as never;
}

describe('request security rate limiting', () => {
  it('rate limits private D1-heavy reads that are hard to cache', async () => {
    const kv = new MemoryKV();
    const stateDo = new MemoryStateNamespace();

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
          stateDo,
        }));

        expect(response).toBeNull();
      }
    }

    const blocked = await runRequestSecurity(createEvent({
      pathname: '/api/orgs/acme',
      routeId: '/api/orgs/[slug]',
      kv,
      stateDo,
    }));

    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('x-ratelimit-limit')).toBe('300');
    expect(stateDo.fetches).toBeGreaterThan(0);
    expect(kv.puts).toBe(0);
    expect(kv.gets).toBe(0);
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
