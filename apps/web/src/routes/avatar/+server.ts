import type { RequestHandler } from './$types';
import { clampAvatarSize, isSupportedPublicAvatarUrl, normalizePublicAvatarUrl } from '$lib/avatar';
import { fetchPublicAssetResponse } from '$lib/server/cache/public-assets';

const AVATAR_PROXY_TTL_SECONDS = 30 * 24 * 60 * 60;
const AVATAR_CACHE_CONTROL = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=31536000';
const NOT_FOUND_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

function errorResponse(status: number, message: string, cacheControl = 'no-store'): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Cache': 'BYPASS',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const rawUrl = url.searchParams.get('u');
  const size = clampAvatarSize(Number(url.searchParams.get('s')));
  const normalizedUrl = normalizePublicAvatarUrl(rawUrl, size);

  if (!normalizedUrl || !isSupportedPublicAvatarUrl(normalizedUrl)) {
    return errorResponse(400, 'Unsupported avatar URL');
  }

  try {
    const { response, hit } = await fetchPublicAssetResponse({
      url: normalizedUrl,
      cacheKeyPrefix: `asset:avatar:${size}`,
      ttlSeconds: AVATAR_PROXY_TTL_SECONDS,
      waitUntil: platform?.context?.waitUntil?.bind(platform.context),
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'SkillsCat Avatar Proxy/1.0',
      },
    });

    if (!response.ok) {
      return errorResponse(
        response.status === 404 ? 404 : 502,
        response.status === 404 ? 'Avatar not found' : 'Failed to fetch avatar',
        NOT_FOUND_CACHE_CONTROL,
      );
    }

    const headers = new Headers();
    headers.set('Cache-Control', AVATAR_CACHE_CONTROL);
    headers.set('Content-Type', response.headers.get('Content-Type') || 'image/png');
    headers.set('X-Cache', hit ? 'HIT' : 'MISS');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch {
    return errorResponse(502, 'Failed to fetch avatar', NOT_FOUND_CACHE_CONTROL);
  }
};
