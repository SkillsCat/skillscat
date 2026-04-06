import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAvatarProxyUrl,
  normalizePublicAvatarUrl,
  resolvePublicAvatarUrl,
} from '../src/lib/avatar';

const fetchPublicAssetResponse = vi.fn();

vi.mock('$lib/server/cache/public-assets', () => ({
  fetchPublicAssetResponse,
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchPublicAssetResponse.mockReset();
});

describe('avatar helpers', () => {
  it('normalizes legacy github.com png avatars to avatars.githubusercontent.com', () => {
    expect(normalizePublicAvatarUrl('https://github.com/octocat.png', 160)).toBe(
      'https://avatars.githubusercontent.com/octocat?s=160',
    );
  });

  it('routes supported github avatars through the local proxy', () => {
    const proxied = resolvePublicAvatarUrl({
      src: 'https://avatars.githubusercontent.com/u/1?v=4',
      requestedSize: 96,
    });

    expect(proxied).toBe(
      '/avatar?u=https%3A%2F%2Favatars.githubusercontent.com%2Fu%2F1%3Fv%3D4%26s%3D96&s=96',
    );
  });

  it('leaves non-github avatar URLs untouched', () => {
    expect(resolvePublicAvatarUrl({
      src: 'https://cdn.example.com/avatar.png',
      requestedSize: 96,
    })).toBe('https://cdn.example.com/avatar.png');
  });

  it('builds proxy URLs for github fallback usernames', () => {
    expect(resolvePublicAvatarUrl({
      fallback: 'octocat',
      useGithubFallback: true,
      requestedSize: 64,
    })).toBe(buildAvatarProxyUrl('https://avatars.githubusercontent.com/octocat?s=64', 64));
  });
});

describe('avatar route', () => {
  it('proxies supported github avatars with long-lived shared caching', async () => {
    fetchPublicAssetResponse.mockResolvedValue({
      response: new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'Content-Type': 'image/webp',
        },
      }),
      hit: true,
    });

    const waitUntil = vi.fn();
    const { GET } = await import('../src/routes/avatar/+server');
    const response = await GET({
      url: new URL('https://skills.cat/avatar?u=https%3A%2F%2Fgithub.com%2Foctocat.png&s=96'),
      platform: {
        context: { waitUntil },
      },
    } as never);

    expect(fetchPublicAssetResponse).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://avatars.githubusercontent.com/octocat?s=96',
      cacheKeyPrefix: 'asset:avatar:96',
      ttlSeconds: 2592000,
      waitUntil: expect.any(Function),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=31536000',
    );
    expect(response.headers.get('x-cache')).toBe('HIT');
  });

  it('rejects unsupported remote URLs', async () => {
    const { GET } = await import('../src/routes/avatar/+server');
    const response = await GET({
      url: new URL('https://skills.cat/avatar?u=https%3A%2F%2Fexample.com%2Favatar.png&s=96'),
      platform: {
        context: { waitUntil: vi.fn() },
      },
    } as never);

    expect(fetchPublicAssetResponse).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-cache')).toBe('BYPASS');
  });
});
