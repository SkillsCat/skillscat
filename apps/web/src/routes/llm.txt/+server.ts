import type { RequestHandler } from './$types';
import { buildLlmTxt } from '$lib/server/llm-txt';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

export const GET: RequestHandler = async () => {
  return new Response(buildLlmTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    }
  });
};

export const HEAD = GET;
