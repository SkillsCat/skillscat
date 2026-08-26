import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveAgentSkillsDiscoveryIndex } from '$lib/server/agent/skills-discovery';

const RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'private, no-cache',
  'CDN-Cache-Control': 'no-store',
  Vary: 'Origin',
  'X-Content-Type-Options': 'nosniff',
};

export const GET: RequestHandler = async ({ platform }) => {
  const resolved = await resolveAgentSkillsDiscoveryIndex({
    db: platform?.env?.DB,
    waitUntil: platform?.context?.waitUntil?.bind(platform.context),
  });

  if (!resolved.data) {
    return json(
      { error: resolved.error || 'Failed to build Agent Skills discovery index' },
      {
        status: resolved.status,
        headers: {
          ...RESPONSE_HEADERS,
          'Cache-Control': 'no-store',
          'X-Cache': resolved.cacheStatus,
        },
      }
    );
  }

  return json(resolved.data, {
    status: 200,
    headers: {
      ...RESPONSE_HEADERS,
      'X-Cache': resolved.cacheStatus,
    },
  });
};

export const HEAD: RequestHandler = async ({ platform }) => new Response(null, {
  status: platform?.env?.DB ? 200 : 503,
  headers: {
    ...RESPONSE_HEADERS,
    'Cache-Control': platform?.env?.DB ? RESPONSE_HEADERS['Cache-Control'] : 'no-store',
    'X-Cache': 'BYPASS',
  },
});
