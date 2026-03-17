import { describe, expect, it } from 'vitest';
import { runRequestSecurity } from '../src/lib/server/request-security';

class MemoryKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function createApiTokenDb(row: {
  id: string;
  user_id: string | null;
  org_id: string | null;
  name: string;
  scopes: string;
  expires_at: number | null;
}) {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM api_tokens')) {
                return row;
              }
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

describe('request security rate-limit identity', () => {
  it('shares the same bucket across IPs for the same API token user', async () => {
    const sharedKv = new MemoryKV();
    const sharedDb = createApiTokenDb({
      id: 'tok_1',
      user_id: 'user_1',
      org_id: null,
      name: 'CLI token',
      scopes: '["read"]',
      expires_at: null,
    });

    const buildEvent = (ip: string) => ({
      url: new URL('https://skills.cat/api/tools/search-skills?q=test'),
      request: new Request('https://skills.cat/api/tools/search-skills?q=test', {
        method: 'GET',
        headers: {
          authorization: 'Bearer sk_testtoken',
          'cf-connecting-ip': ip,
          'user-agent': 'skillscat-cli/1.0',
        },
      }),
      platform: {
        env: {
          DB: sharedDb,
          KV: sharedKv,
        },
      },
      route: { id: '/api/tools/search-skills' },
    }) as never;

    for (let index = 0; index < 80; index += 1) {
      const response = await runRequestSecurity(buildEvent('198.51.100.10'));
      expect(response).toBeNull();
    }

    const blocked = await runRequestSecurity(buildEvent('198.51.100.11'));
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('x-ratelimit-limit')).toBe('80');
  });

  it('rate limits OpenClaw compat search without applying the native UA gate', async () => {
    const sharedKv = new MemoryKV();

    const buildEvent = () => ({
      url: new URL('https://skills.cat/openclaw/api/v1/search?q=test'),
      request: new Request('https://skills.cat/openclaw/api/v1/search?q=test', {
        method: 'GET',
        headers: {
          'cf-connecting-ip': '198.51.100.20',
          'user-agent': 'curl/8.7.1',
        },
      }),
      platform: {
        env: {
          KV: sharedKv,
        },
      },
      route: { id: '/openclaw/api/v1/search' },
    }) as never;

    for (let index = 0; index < 120; index += 1) {
      const response = await runRequestSecurity(buildEvent());
      expect(response).toBeNull();
    }

    const blocked = await runRequestSecurity(buildEvent());
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('x-ratelimit-limit')).toBe('120');
  });
});
