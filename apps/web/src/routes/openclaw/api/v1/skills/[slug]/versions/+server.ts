import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildOpenClawResponseHeaders } from '$lib/server/openclaw/registry';
import { decodeClawHubCompatSlug } from '$lib/server/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';
import {
  buildOpenClawVersionsListCacheKey,
  getOpenClawVersionsStateToken,
  resolveOpenClawJsonCache,
} from '$lib/server/openclaw/cache';

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
  const r2 = platform?.env?.R2;
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

  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug: params.slug,
    updatedAt: resolved.data.skill.updatedAt,
    createdAt: resolved.data.skill.createdAt,
  });

  const buildPayload = () => ({
    items: versionState.versions.map((entry) => ({
      version: entry.version,
      createdAt: entry.createdAt,
      changelog: entry.changelog,
      changelogSource: entry.changelogSource,
    })),
    nextCursor: null,
  });

  const cached = await resolveOpenClawJsonCache({
    cacheKey: buildOpenClawVersionsListCacheKey({
      compatSlug: params.slug,
      versionsStateToken: getOpenClawVersionsStateToken(versionState),
    }),
    load: async () => buildPayload(),
    waitUntil,
    cacheControl: resolved.cacheControl,
    cacheStatus: resolved.cacheStatus,
  });

  return json(cached.data, {
    headers: cached.headers,
  });
};
