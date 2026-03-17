import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveClaudeMarketplace } from '$lib/server/marketplace/claude';

function responseHeaders(opts: {
  cacheControl: string;
  cacheStatus?: 'HIT' | 'MISS' | 'BYPASS';
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': opts.cacheControl,
  };

  if (opts.cacheStatus) {
    headers['X-Cache'] = opts.cacheStatus;
  }

  return headers;
}

export const GET: RequestHandler = async ({ platform }) => {
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const resolved = await resolveClaudeMarketplace({ db, waitUntil });

  if (!resolved.data) {
    return json(
      { error: resolved.error || 'Failed to build marketplace' },
      {
        status: resolved.status,
        headers: responseHeaders({
          cacheControl: resolved.cacheControl,
          cacheStatus: resolved.cacheStatus,
        }),
      }
    );
  }

  return json(resolved.data, {
    status: resolved.status,
    headers: responseHeaders({
      cacheControl: resolved.cacheControl,
      cacheStatus: resolved.cacheStatus,
    }),
  });
};

export const HEAD = GET;
