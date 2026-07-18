import { describe, expect, it } from 'vitest';

import {
  acquireOpenClawPublishLock,
  releaseOpenClawPublishLock,
} from '../src/lib/server/openclaw/compat-store';

interface StoredLock {
  etag: string;
  customMetadata?: Record<string, string>;
}

class LockR2 {
  private readonly objects = new Map<string, StoredLock>();
  private version = 0;

  async head(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { key, ...object };
  }

  async put(
    key: string,
    _value: unknown,
    options?: {
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
      customMetadata?: Record<string, string>;
    }
  ) {
    const existing = this.objects.get(key);
    if (options?.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) {
      return null;
    }
    if (options?.onlyIf?.etagDoesNotMatch === '*' && existing) {
      return null;
    }

    const stored = {
      etag: `etag-${++this.version}`,
      customMetadata: options?.customMetadata,
    };
    this.objects.set(key, stored);
    return { key, ...stored };
  }
}

describe('OpenClaw publish lock', () => {
  it('serializes a slug and allows acquisition again after release', async () => {
    const r2 = new LockR2() as unknown as R2Bucket;
    const first = await acquireOpenClawPublishLock(r2, 'acme~demo', 1_000);

    expect(first).not.toBeNull();
    await expect(acquireOpenClawPublishLock(r2, 'acme~demo', 1_001)).resolves.toBeNull();

    await releaseOpenClawPublishLock(r2, first!);
    await expect(acquireOpenClawPublishLock(r2, 'acme~demo', 1_002)).resolves.toMatchObject({
      key: expect.stringContaining('acme~demo'),
    });
  });

  it('takes over an expired lock with an ETag condition', async () => {
    const r2 = new LockR2() as unknown as R2Bucket;
    await acquireOpenClawPublishLock(r2, 'acme~demo', 1_000);

    await expect(acquireOpenClawPublishLock(r2, 'acme~demo', 1_000 + 2 * 60 * 1000 + 1))
      .resolves.toMatchObject({ key: expect.stringContaining('acme~demo') });
  });
});
