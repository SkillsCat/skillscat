import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createStoredZip,
  decodeClawHubCompatSlug,
} from '$lib/server/clawhub-compat';
import {
  buildOpenClawResponseHeaders,
  isSupportedOpenClawTag,
} from '$lib/server/openclaw-registry';
import { resolveSkillDetail } from '$lib/server/skill-detail';
import {
  resolveOpenClawFilesForVersion,
  resolveOpenClawVersionState,
} from '$lib/server/openclaw-skill-state';
import { resolveOpenClawBundleFiles } from '$lib/server/openclaw-bundle-files';

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const slug = decodeClawHubCompatSlug(url.searchParams.get('slug') ?? '');
  const version = url.searchParams.get('version');
  const tag = url.searchParams.get('tag');

  if (!slug) {
    return json(
      { error: 'Query parameter "slug" is required.' },
      {
        status: 400,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }
  if (!isSupportedOpenClawTag(tag)) {
    return json(
      { error: 'Requested tag is not available.' },
      {
        status: 404,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  const detail = await resolveSkillDetail({ db, request, locals, waitUntil }, slug);
  if (!detail.data) {
    return json(
      { error: detail.error || 'Skill not found.' },
      {
        status: detail.status,
        headers: buildOpenClawResponseHeaders({
          cacheControl: detail.cacheControl,
          cacheStatus: detail.cacheStatus,
        }),
      }
    );
  }

  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug: url.searchParams.get('slug') ?? '',
    updatedAt: detail.data.skill.updatedAt,
    createdAt: detail.data.skill.createdAt,
    requestedVersion: version,
    requestedTag: tag,
  });

  if (!versionState.selectedVersion) {
    return json(
      { error: 'Requested version is not available.' },
      {
        status: 404,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }

  try {
    const fallbackFiles = await resolveOpenClawBundleFiles({
      skill: detail.data.skill,
      r2,
      githubToken,
    });
    const files = await resolveOpenClawFilesForVersion({
      r2,
      compatSlug: url.searchParams.get('slug') ?? '',
      selectedVersion: versionState.selectedVersion,
      fallbackFiles,
    });
    const zipBuffer = createStoredZip(files);

    try {
      await db
        ?.prepare(`
          INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
          VALUES (?, NULL, ?, 'download', ?)
        `)
        .bind(crypto.randomUUID(), detail.data.skill.id, Date.now())
        .run();
    } catch {
      // non-critical compatibility telemetry
    }

    return new Response(zipBuffer as unknown as BodyInit, {
      headers: {
        ...buildOpenClawResponseHeaders({
          cacheControl: detail.cacheControl,
          cacheStatus: detail.cacheStatus,
        }),
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${detail.data.skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}.zip"`,
      },
    });
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'Failed to download skill bundle.';
    const status =
      err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 500;

    return json(
      { error: message },
      {
        status,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }
};
