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

  // Resolve upload sources in one batch. GitHub-backed skills do not have an
  // OpenClaw manifest, so they must not trigger one R2 miss per search result.
  const uploadSkillIds = new Set<string>();
  if (db && resolved.data.skills.length > 0) {
    const ids = resolved.data.skills.map((skill) => skill.id);
    const placeholders = ids.map(() => '?').join(',');
    try {
      const uploadRows = await db.prepare(
        `SELECT id FROM skills WHERE id IN (${placeholders}) AND source_type = 'upload'`
      ).bind(...ids).all<{ id: string }>();
      for (const row of uploadRows.results || []) {
        uploadSkillIds.add(row.id);
      }
    } catch {
      // Older preview schemas may not have source_type; treat results as
      // GitHub-backed and skip manifest probing rather than failing search.
    }
  }

  const results = await Promise.all(
    resolved.data.skills.map(async (skill, index, list) => {
      const compatSlug = encodeClawHubCompatSlug(skill.slug);
      const versionState = await resolveOpenClawVersionState({
        // GitHub-backed skills never have a publish manifest. Avoid an R2
        // miss for every search result and derive their version from D1.
        r2: uploadSkillIds.has(skill.id) ? r2 : undefined,
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
