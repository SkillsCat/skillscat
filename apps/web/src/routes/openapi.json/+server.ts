import type { RequestHandler } from './$types';
import { buildOpenApiDocument, isPublicApiKey } from '$lib/server/agent/openapi';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const CONTENT_TYPE = 'application/vnd.oai.openapi+json;version=3.1; charset=utf-8';

function responseHeaders(cacheControl = CACHE_CONTROL): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheControl,
    'Content-Type': CONTENT_TYPE,
    'X-Cache': cacheControl === CACHE_CONTROL ? 'STATIC' : 'BYPASS',
    'X-Robots-Tag': 'noindex, follow, noarchive',
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const requestedApi = url.searchParams.get('api');

  if (requestedApi !== null && !isPublicApiKey(requestedApi)) {
    return new Response(JSON.stringify({ error: 'Unknown public API' }), {
      status: 400,
      headers: responseHeaders('no-store'),
    });
  }

  return new Response(JSON.stringify(buildOpenApiDocument(requestedApi ?? undefined)), {
    status: 200,
    headers: responseHeaders(),
  });
};

export const HEAD: RequestHandler = async ({ url }) => {
  const requestedApi = url.searchParams.get('api');

  return new Response(null, {
    status: requestedApi === null || isPublicApiKey(requestedApi) ? 200 : 400,
    headers: responseHeaders(requestedApi === null || isPublicApiKey(requestedApi) ? CACHE_CONTROL : 'no-store'),
  });
};
