import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildIndexNowSkillUrls,
  getIndexNowKeyLocation,
  resolveIndexNowOwnerHandle,
  submitIndexNowUrls,
} from '../src/lib/server/seo/indexnow';

class MemoryKv {
  store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

describe('buildIndexNowSkillUrls', () => {
  it('builds canonical skill and org URLs for public skills', () => {
    expect(buildIndexNowSkillUrls({
      slug: 'acme/demo-skill',
      visibility: 'public',
      orgSlug: 'acme',
      ownerHandle: 'ignored',
    })).toEqual([
      'https://skills.cat/skills/acme/demo-skill',
      'https://skills.cat/org/acme',
    ]);
  });

  it('uses PUBLIC_APP_URL when provided', () => {
    expect(buildIndexNowSkillUrls({
      slug: 'acme/demo-skill',
      visibility: 'public',
      ownerHandle: 'acme',
    }, { PUBLIC_APP_URL: 'https://preview.skillscat.example/' })).toEqual([
      'https://preview.skillscat.example/skills/acme/demo-skill',
      'https://preview.skillscat.example/u/acme',
    ]);
  });

  it('omits non-public skills', () => {
    expect(buildIndexNowSkillUrls({
      slug: 'acme/private-skill',
      visibility: 'private',
      ownerHandle: 'acme',
    })).toEqual([]);
  });

  it('does not add a user profile URL when there is no stable owner handle', () => {
    expect(buildIndexNowSkillUrls({
      slug: 'acme/demo-skill',
      visibility: 'public',
      ownerHandle: null,
    })).toEqual([
      'https://skills.cat/skills/acme/demo-skill',
    ]);
  });
});

describe('resolveIndexNowOwnerHandle', () => {
  it('prefers the repo owner when available', () => {
    expect(resolveIndexNowOwnerHandle('acme', 'octocat')).toBe('acme');
  });

  it('falls back to the linked author username', () => {
    expect(resolveIndexNowOwnerHandle(null, 'octocat')).toBe('octocat');
  });

  it('returns null when there is no stable owner handle', () => {
    expect(resolveIndexNowOwnerHandle(null, null)).toBeNull();
  });
});

describe('getIndexNowKeyLocation', () => {
  it('uses the default root-level key-named file when unset', () => {
    expect(getIndexNowKeyLocation({ INDEXNOW_KEY: 'secret-key' })).toBe('https://skills.cat/secret-key.txt');
  });

  it('returns empty when neither key nor override is configured', () => {
    expect(getIndexNowKeyLocation(undefined)).toBe('');
  });

  it('accepts root-relative overrides', () => {
    expect(getIndexNowKeyLocation({ INDEXNOW_KEY_LOCATION: '/custom-indexnow.txt' })).toBe(
      'https://skills.cat/custom-indexnow.txt'
    );
  });

  it('uses PUBLIC_APP_URL for the default key location', () => {
    expect(getIndexNowKeyLocation({
      PUBLIC_APP_URL: 'https://preview.skillscat.example/',
      INDEXNOW_KEY: 'secret-key',
    })).toBe('https://preview.skillscat.example/secret-key.txt');
  });
});

describe('indexnow key route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
  });

  it('serves the configured key from the root-level key file path', async () => {
    const { GET } = await import('../src/routes/[key].txt/+server');
    const response = await GET({
      params: { key: 'secret-key' },
      platform: { env: { INDEXNOW_KEY: 'secret-key' }, context: {} },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    await expect(response.text()).resolves.toBe('secret-key');
  });

  it('returns 404 when the requested key does not match the configured key', async () => {
    const { GET } = await import('../src/routes/[key].txt/+server');
    const response = await GET({
      params: { key: 'wrong-key' },
      platform: { env: { INDEXNOW_KEY: 'secret-key' }, context: {} },
    } as never);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('Not Found');
  });
});

describe('submitIndexNowUrls', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
  });

  it('submits normalized same-host URLs and filters duplicates', async () => {
    const kv = new MemoryKv();

    const result = await submitIndexNowUrls({
      env: {
        INDEXNOW_KEY: 'secret-key',
        KV: kv as unknown as KVNamespace,
      },
      urls: [
        '/skills/acme/demo-skill',
        'https://skills.cat/skills/acme/demo-skill',
        'https://skills.cat/u/acme',
        'https://skills.cat/search?q=test',
        'https://example.com/skills/acme/demo-skill',
      ],
      source: 'test-normalize',
      fetchImpl,
    });

    expect(result).toMatchObject({
      attempted: 2,
      submitted: 2,
      skipped: 0,
      disabled: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [endpoint, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe('https://api.indexnow.org/indexnow');
    expect(requestInit.method).toBe('POST');

    const body = JSON.parse(String(requestInit.body));
    expect(body).toEqual({
      host: 'skills.cat',
      key: 'secret-key',
      keyLocation: 'https://skills.cat/secret-key.txt',
      urlList: [
        'https://skills.cat/skills/acme/demo-skill',
        'https://skills.cat/u/acme',
      ],
    });
  });

  it('uses a root-level keyLocation by default and allows overrides', async () => {
    await submitIndexNowUrls({
      env: {
        INDEXNOW_KEY: 'secret-key',
        INDEXNOW_KEY_LOCATION: '/custom-indexnow.txt',
      },
      urls: ['https://skills.cat/skills/acme/demo-skill'],
      source: 'explicit-key-location',
      fetchImpl,
    });

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.keyLocation).toBe('https://skills.cat/custom-indexnow.txt');
  });

  it('uses PUBLIC_APP_URL for host and keyLocation', async () => {
    await submitIndexNowUrls({
      env: {
        PUBLIC_APP_URL: 'https://preview.skillscat.example/',
        INDEXNOW_KEY: 'secret-key',
      },
      urls: ['/skills/acme/demo-skill'],
      source: 'custom-origin',
      fetchImpl,
    });

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.host).toBe('preview.skillscat.example');
    expect(body.keyLocation).toBe('https://preview.skillscat.example/secret-key.txt');
    expect(body.urlList).toEqual(['https://preview.skillscat.example/skills/acme/demo-skill']);
  });

  it('uses KV to skip duplicate submissions after a successful push', async () => {
    const kv = new MemoryKv();
    const env = {
      INDEXNOW_KEY: 'secret-key',
      KV: kv as unknown as KVNamespace,
    };

    await submitIndexNowUrls({
      env,
      urls: ['https://skills.cat/skills/acme/demo-skill'],
      source: 'first-pass',
      fetchImpl,
    });

    const secondPass = await submitIndexNowUrls({
      env,
      urls: ['https://skills.cat/skills/acme/demo-skill'],
      source: 'second-pass',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(secondPass).toMatchObject({
      attempted: 1,
      submitted: 0,
      skipped: 1,
      disabled: false,
    });
  });

  it('does not submit when the feature is disabled', async () => {
    const result = await submitIndexNowUrls({
      env: {
        INDEXNOW_ENABLED: '0',
        INDEXNOW_KEY: 'secret-key',
      },
      urls: ['https://skills.cat/skills/acme/demo-skill'],
      source: 'disabled',
      fetchImpl,
    });

    expect(result).toMatchObject({
      attempted: 1,
      submitted: 0,
      skipped: 1,
      disabled: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
