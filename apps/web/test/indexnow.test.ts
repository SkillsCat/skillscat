import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildIndexNowSkillUrls,
  getIndexNowKeyLocation,
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

  it('omits non-public skills', () => {
    expect(buildIndexNowSkillUrls({
      slug: 'acme/private-skill',
      visibility: 'private',
      ownerHandle: 'acme',
    })).toEqual([]);
  });
});

describe('getIndexNowKeyLocation', () => {
  it('uses the default root-level key file when unset', () => {
    expect(getIndexNowKeyLocation(undefined)).toBe('https://skills.cat/indexnow.txt');
  });

  it('accepts root-relative overrides', () => {
    expect(getIndexNowKeyLocation({ INDEXNOW_KEY_LOCATION: '/custom-indexnow.txt' })).toBe(
      'https://skills.cat/custom-indexnow.txt'
    );
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
        INDEXNOW_KEY_LOCATION: '/indexnow.txt',
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
      keyLocation: 'https://skills.cat/indexnow.txt',
      urlList: [
        'https://skills.cat/skills/acme/demo-skill',
        'https://skills.cat/u/acme',
      ],
    });
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
