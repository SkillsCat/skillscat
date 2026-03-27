import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const INDEXNOW_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
const INDEXNOW_ROBOTS = 'noindex, nofollow, noarchive';

function getIndexNowKey(platformKey: string | undefined): string {
  return (env.INDEXNOW_KEY || platformKey || '').trim();
}

export const GET: RequestHandler = async ({ platform }) => {
  const key = getIndexNowKey(platform?.env?.INDEXNOW_KEY);
  if (!key) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': INDEXNOW_ROBOTS,
      },
    });
  }

  return new Response(key, {
    headers: {
      'Cache-Control': INDEXNOW_CACHE_CONTROL,
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': INDEXNOW_ROBOTS,
    },
  });
};

export const HEAD = GET;
