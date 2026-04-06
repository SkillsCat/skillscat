import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveOrgPagePayload } from '$lib/server/org/page';

/**
 * GET /api/orgs/[slug]/page - Get organization page snapshot
 */
export const GET: RequestHandler = async ({ params, platform, locals }) => {
  const slug = params.slug?.trim();
  if (!slug) {
    return json(
      {
        slug: '',
        org: null,
        members: [],
        skills: [],
        error: 'Organization slug is required',
        errorKind: 'temporary_failure',
      },
      {
        status: 400,
        headers: {
          'Cache-Control': 'no-store',
          'X-Cache': 'BYPASS',
        },
      }
    );
  }

  const resolved = await resolveOrgPagePayload(
    {
      db: platform?.env?.DB,
      locals,
      waitUntil: platform?.context?.waitUntil?.bind(platform.context),
    },
    slug
  );

  return json(resolved.data, {
    status: resolved.status,
    headers: {
      'Cache-Control': resolved.cacheControl,
      'X-Cache': resolved.cacheStatus,
    },
  });
};
