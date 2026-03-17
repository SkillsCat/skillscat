import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
} from '$lib/server/openclaw/registry';
import {
  parseRegistrySearchInput,
  resolveRegistrySearch,
} from '$lib/server/registry/search';
import {
  buildClawHubCompatScore,
  encodeClawHubCompatSlug,
} from '$lib/server/openclaw/clawhub-compat';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  if (!query) {
    return json(
      { error: 'Query parameter "q" is required.' },
      {
        status: 400,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }

  const input = parseRegistrySearchInput({
    q: query,
    limit: url.searchParams.get('limit'),
    include_private: url.searchParams.get('include_private'),
  });

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const resolved = await resolveRegistrySearch({ db, request, locals, waitUntil }, input);

  const results = await Promise.all(
    resolved.data.skills.map(async (skill, index, list) => {
      const compatSlug = encodeClawHubCompatSlug(skill.slug);
      const versionState = await resolveOpenClawVersionState({
        r2,
        compatSlug,
        updatedAt: skill.updatedAt,
      });

      return {
        slug: compatSlug,
        displayName: skill.name,
        summary: skill.description || null,
        version: versionState.latestVersion.version,
        score: buildClawHubCompatScore(index, list.length),
        updatedAt: skill.updatedAt,
      };
    })
  );

  return json(
    {
      results,
    },
    {
      headers: buildOpenClawResponseHeaders({
        cacheControl: resolved.cacheControl,
        cacheStatus: resolved.cacheStatus,
      }),
    }
  );
};
