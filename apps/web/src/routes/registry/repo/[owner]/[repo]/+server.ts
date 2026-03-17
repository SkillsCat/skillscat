import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  parseRegistryRepoInput,
  resolveRegistryRepo,
  type RegistryRepoResult,
} from '$lib/server/registry/repo';

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

function getHttpErrorMessage(err: { body: unknown; status: number }): string {
  if (typeof err.body === 'object' && err.body !== null && 'message' in err.body) {
    return String((err.body as { message: unknown }).message);
  }

  return `Request failed (${err.status})`;
}

export const GET: RequestHandler = async ({ params, platform, request, locals, url }) => {
  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const input = parseRegistryRepoInput({
    owner: params.owner,
    repo: params.repo,
    ...(url.searchParams.has('path') ? { path: url.searchParams.get('path') } : {}),
  });

  if (!input) {
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
      {
        status: 400,
        headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' })
      }
    );
  }

  try {
    const resolved = await resolveRegistryRepo({ db, request, locals, waitUntil }, input);

    return json(resolved.data, {
      headers: responseHeaders({
        cacheControl: resolved.cacheControl,
        cacheStatus: resolved.cacheStatus,
      })
    });
  } catch (err) {
    if (isHttpError(err)) {
      return json(
        { error: getHttpErrorMessage(err) },
        {
          status: err.status,
          headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' })
        }
      );
    }

    console.error('Error fetching registry repo skills:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
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
