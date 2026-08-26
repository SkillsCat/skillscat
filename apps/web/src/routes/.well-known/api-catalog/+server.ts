import type { RequestHandler } from './$types';
import {
  API_CATALOG_CONTENT_TYPE,
  API_CATALOG_LINK_HEADER,
  buildApiCatalog,
} from '$lib/server/agent/discovery-links';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

function responseHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': CACHE_CONTROL,
    'Content-Type': API_CATALOG_CONTENT_TYPE,
    Link: API_CATALOG_LINK_HEADER,
    'X-Cache': 'STATIC',
  };
}

export const GET: RequestHandler = async () => new Response(JSON.stringify(buildApiCatalog()), {
  status: 200,
  headers: responseHeaders(),
});

export const HEAD: RequestHandler = async () => new Response(null, {
  status: 200,
  headers: responseHeaders(),
});
