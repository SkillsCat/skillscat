import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubRequestAuthFromEnv } from '$lib/server/github-client/env';
import { parseSkillFilesInput, resolveSkillFiles } from '$lib/server/skill/files';

function responseHeaders(opts: { cacheControl: string; cacheStatus?: 'HIT' | 'MISS' | 'BYPASS' }): Record<string, string> {
  const headers: Record<string, string> = {
    'Cache-Control': opts.cacheControl,
    Vary: 'Authorization',
  };
  if (opts.cacheStatus) {
    headers['X-Cache'] = opts.cacheStatus;
  }
  return headers;
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

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const input = parseSkillFilesInput({ slug: params.slug });
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = getGitHubRequestAuthFromEnv(platform?.env).token as string | undefined;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  if (!input) {
    return json(
      { error: 'Invalid skill slug' },
      { status: 400, headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' }) }
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
      headers: responseHeaders({
        cacheControl: resolved.cacheControl,
        cacheStatus: resolved.cacheStatus,
      })
    });
  } catch (err) {
    return json(
      { error: getErrorMessage(err) },
      {
        status: getErrorStatus(err),
        headers: responseHeaders({ cacheControl: 'no-store', cacheStatus: 'BYPASS' })
      }
    );
  }
};
