import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
} from '$lib/server/openclaw/registry';
import { decodeClawHubCompatSlug } from '$lib/server/openclaw/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill/detail';

export const GET: RequestHandler = async ({ params, platform, request, locals }) => {
  const slug = decodeClawHubCompatSlug(params.slug);
  if (!slug) {
    return json(
      { error: 'Invalid compatibility slug.' },
      {
        status: 400,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }

  const db = platform?.env?.DB;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const resolved = await resolveSkillDetail({ db, request, locals, waitUntil }, slug);

  if (!resolved.data) {
    return json(
      { error: resolved.error || 'Skill not found.' },
      {
        status: resolved.status,
        headers: buildOpenClawResponseHeaders({
          cacheControl: resolved.cacheControl,
          cacheStatus: resolved.cacheStatus,
        }),
      }
    );
  }

  return json(
    {
      moderation: null,
    },
    {
      headers: buildOpenClawResponseHeaders({
        cacheControl: resolved.cacheControl,
        cacheStatus: resolved.cacheStatus,
      }),
    }
  );
};
