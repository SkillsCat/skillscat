import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  parseRegistrySearchInput,
  resolveRegistrySearch,
  type RegistrySearchResult,
} from '$lib/server/registry-search';

function baseCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    Vary: 'Authorization',
  };
}

function responseHeaders(opts: { cacheControl: string; cacheStatus?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    ...baseCorsHeaders(),
    'Cache-Control': opts.cacheControl,
  };
  if (opts.cacheStatus) {
    headers['X-Cache'] = opts.cacheStatus;
  }
  return headers;
}

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const input = parseRegistrySearchInput({
    q: url.searchParams.get('q'),
    category: url.searchParams.get('category'),
    limit: url.searchParams.get('limit'),
    pageSize: url.searchParams.get('pageSize'),
    offset: url.searchParams.get('offset'),
    include_private: url.searchParams.get('include_private'),
  });

  try {
    const resolved = await resolveRegistrySearch({ db, request, locals, waitUntil }, input);

    return json(resolved.data, {
      headers: responseHeaders({
        cacheControl: resolved.cacheControl,
        cacheStatus: resolved.cacheStatus,
      })
    });
  } catch (err) {
    console.error('Error searching skills:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistrySearchResult,
      {
        status: 500,
        headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' })
      }
    );
  }
};

export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
};
