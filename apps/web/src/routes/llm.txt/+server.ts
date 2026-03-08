import type { RequestHandler } from './$types';
import { getCachedText } from '$lib/server/cache';
import { buildLlmTxt } from '$lib/server/llm-txt';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const CACHE_TTL_SECONDS = 3600;

export const GET: RequestHandler = async ({ platform }) => {
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const { data, hit } = await getCachedText(
    'llm.txt',
    async () => buildLlmTxt(),
    CACHE_TTL_SECONDS,
    { waitUntil }
  );

  return new Response(data, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      'X-Cache': hit ? 'HIT' : 'MISS',
    }
  });
};

export const HEAD = GET;
