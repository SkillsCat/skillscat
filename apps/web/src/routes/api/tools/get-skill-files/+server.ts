import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubRequestAuthFromEnv } from '$lib/server/github-client/env';
import { parseSkillFilesInput, resolveSkillFiles } from '$lib/server/skill/files';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    Vary: 'Authorization',
  };
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    if ('body' in err && err.body && typeof err.body === 'object' && 'message' in err.body && typeof err.body.message === 'string') {
      return err.body.message;
    }
    if ('message' in err && typeof err.message === 'string') {
      return err.message;
    }
  }
  return 'Failed to fetch skill files';
}

function getErrorStatus(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
    return err.status;
  }
  return 500;
}

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const input = parseSkillFilesInput({ slug: url.searchParams.get('slug') });
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  if (!input) {
    return json(
      { error: 'Invalid skill slug' },
      { status: 400, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const resolved = await resolveSkillFiles({
      db,
      r2,
      githubToken,
      githubRateLimitKV: platform?.env?.KV,
      request,
      locals,
      waitUntil,
    }, input);
    return json(resolved.data, {
      headers: {
        ...corsHeaders(),
        'Cache-Control': resolved.cacheControl,
        'X-Cache': resolved.cacheStatus,
      }
    });
  } catch (err) {
    return json(
      { error: getErrorMessage(err) },
      { status: getErrorStatus(err), headers: { ...corsHeaders(), 'Cache-Control': 'no-store', 'X-Cache': 'BYPASS' } }
    );
  }
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  let payload: Record<string, unknown> = {};

  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const input = parseSkillFilesInput(payload);

  if (!input) {
    return json(
      { error: 'Invalid skill slug' },
      { status: 400, headers: { ...corsHeaders(), 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const resolved = await resolveSkillFiles({
      db,
      r2,
      githubToken,
      githubRateLimitKV: platform?.env?.KV,
      request,
      locals,
      waitUntil,
    }, input);
    return json(resolved.data, { headers: { ...corsHeaders(), 'Cache-Control': 'no-store', 'X-Cache': 'BYPASS' } });
  } catch (err) {
    return json(
      { error: getErrorMessage(err) },
      { status: getErrorStatus(err), headers: { ...corsHeaders(), 'Cache-Control': 'no-store', 'X-Cache': 'BYPASS' } }
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
