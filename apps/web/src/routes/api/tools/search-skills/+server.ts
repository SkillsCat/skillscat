import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  parseRegistrySearchInput,
  resolveRegistrySearch,
  type RegistrySearchResult,
} from '$lib/server/registry/search';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    Vary: 'Authorization',
  };
}

function responseHeaders(
  resolved: Awaited<ReturnType<typeof resolveRegistrySearch>>,
  noStore = false
): Record<string, string> {
  return {
    ...corsHeaders(),
    'Cache-Control': noStore ? 'no-store' : resolved.cacheControl,
    'X-Cache': noStore ? 'BYPASS' : resolved.cacheStatus,
  };
}

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const input = parseRegistrySearchInput({
    q: url.searchParams.get('q'),
    query: url.searchParams.get('query'),
    category: url.searchParams.get('category'),
    limit: url.searchParams.get('limit'),
    pageSize: url.searchParams.get('pageSize'),
    offset: url.searchParams.get('offset'),
    include_private: url.searchParams.get('include_private'),
    includePrivate: url.searchParams.get('includePrivate'),
  });

  try {
    const resolved = await resolveRegistrySearch({ db, request, locals, waitUntil }, input);
    return json(resolved.data, { headers: responseHeaders(resolved) });
  } catch (err) {
    console.error('Error executing search-skills tool:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistrySearchResult,
      { status: 500, headers: { ...corsHeaders(), 'Cache-Control': 'no-store', 'X-Cache': 'BYPASS' } }
    );
  }
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  let payload: Record<string, unknown> = {};

  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const input = parseRegistrySearchInput(payload);

  try {
    const resolved = await resolveRegistrySearch({ db, request, locals, waitUntil }, input);
    return json(resolved.data, { headers: responseHeaders(resolved, true) });
  } catch (err) {
    console.error('Error executing search-skills tool:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistrySearchResult,
      { status: 500, headers: { ...corsHeaders(), 'Cache-Control': 'no-store', 'X-Cache': 'BYPASS' } }
    );
  }
};

export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    headers: {
      ...corsHeaders(),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
};
