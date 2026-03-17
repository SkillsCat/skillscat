import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  parseRegistryRepoInput,
  resolveRegistryRepo,
  type RegistryRepoResult,
} from '$lib/server/registry/repo';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    Vary: 'Authorization',
  };
}

function successHeaders(
  resolved: Awaited<ReturnType<typeof resolveRegistryRepo>>,
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
  const input = parseRegistryRepoInput({
    owner: url.searchParams.get('owner'),
    repo: url.searchParams.get('repo'),
    ...(url.searchParams.has('path') ? { path: url.searchParams.get('path') } : {}),
  });

  if (!input) {
    return json(
      { error: 'Invalid owner, repo, or path' },
      { status: 400, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const resolved = await resolveRegistryRepo({ db, request, locals, waitUntil }, input);
    return json(resolved.data, { headers: successHeaders(resolved) });
  } catch (err) {
    console.error('Error executing resolve-repo-skills tool:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
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

  const input = parseRegistryRepoInput(payload);

  if (!input) {
    return json(
      { error: 'Invalid owner, repo, or path' },
      { status: 400, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const resolved = await resolveRegistryRepo({ db, request, locals, waitUntil }, input);
    return json(resolved.data, { headers: successHeaders(resolved, true) });
  } catch (err) {
    console.error('Error executing resolve-repo-skills tool:', err);
    return json(
      { skills: [], total: 0 } satisfies RegistryRepoResult,
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
