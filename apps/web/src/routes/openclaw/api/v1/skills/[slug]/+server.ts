import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
  buildOpenClawStats,
} from '$lib/server/openclaw/registry';
import {
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '$lib/server/openclaw/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';
import {
  buildOpenClawSkillDetailCacheKey,
  getOpenClawVersionsStateToken,
  invalidateOpenClawSkillCaches,
  resolveOpenClawJsonCache,
} from '$lib/server/openclaw/cache';
import { getAuthContext, requireScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/auth/permissions';
import { readOpenClawManifest, writeOpenClawManifest } from '$lib/server/openclaw/compat-store';

interface SkillStatsRow {
  stars: number | null;
  downloadCount30d: number | null;
  downloadCount90d: number | null;
}

interface SkillDeleteRow {
  id: string;
  slug: string;
  sourceType: string;
}

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

  const skill = resolved.data.skill;
  const compatSlug = encodeClawHubCompatSlug(skill.slug);
  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug,
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
  });

  const buildPayload = async () => {
    const statsRow = await db
      ?.prepare(`
      SELECT
        stars,
        download_count_30d as downloadCount30d,
        download_count_90d as downloadCount90d
      FROM skills
      WHERE slug = ?
      LIMIT 1
    `)
      .bind(slug)
      .first<SkillStatsRow>();

    return {
      skill: {
        slug: compatSlug,
        displayName: skill.name,
        summary: skill.description || null,
        tags: versionState.tags,
        stats: buildOpenClawStats({
          stars: statsRow?.stars ?? skill.stars,
          downloadCount30d: statsRow?.downloadCount30d,
          downloadCount90d: statsRow?.downloadCount90d,
        }),
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      },
      latestVersion: versionState.latestVersion,
      owner: {
        handle: skill.authorUsername || skill.repoOwner || null,
        displayName: skill.authorDisplayName || skill.repoOwner || null,
        image: skill.authorAvatar || null,
      },
      moderation: null,
    };
  };

  const cached = await resolveOpenClawJsonCache({
    cacheKey: buildOpenClawSkillDetailCacheKey({
      compatSlug,
      skillUpdatedAt: skill.updatedAt,
      versionsStateToken: getOpenClawVersionsStateToken(versionState),
    }),
    load: buildPayload,
    waitUntil,
    cacheControl: resolved.cacheControl,
    cacheStatus: resolved.cacheStatus,
  });

  return json(cached.data, {
    headers: cached.headers,
  });
};

export const DELETE: RequestHandler = async ({ params, platform, request, locals }) => {
  const nativeSlug = decodeClawHubCompatSlug(params.slug);
  if (!nativeSlug) {
    throw error(400, 'Invalid compatibility slug.');
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  if (!db || !r2) {
    throw error(503, 'Storage not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireScope(auth, 'write');

  const skill = await db
    .prepare(`
      SELECT
        id,
        slug,
        source_type as sourceType
      FROM skills
      WHERE slug = ?
      LIMIT 1
    `)
    .bind(nativeSlug)
    .first<SkillDeleteRow>();

  if (!skill) {
    throw error(404, 'Skill not found.');
  }
  if (skill.sourceType !== 'upload') {
    throw error(400, 'Only uploaded SkillsCat skills can be soft-deleted through the ClawHub compatibility API.');
  }

  const canWrite = await canWriteSkill(skill.id, auth.userId, db);
  if (!canWrite) {
    throw error(403, 'You do not have permission to delete this skill.');
  }

  await db.prepare(`UPDATE skills SET visibility = 'private', updated_at = ? WHERE id = ?`).bind(Date.now(), skill.id).run();

  const manifest = await readOpenClawManifest(r2, params.slug);
  if (manifest) {
    await writeOpenClawManifest(r2, {
      ...manifest,
      deleted: true,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  await invalidateOpenClawSkillCaches(skill.id, skill.slug);

  return json(
    { ok: true },
    {
      headers: buildOpenClawResponseHeaders({
        cacheControl: 'no-store',
        cacheStatus: 'BYPASS',
      }),
    }
  );
};
