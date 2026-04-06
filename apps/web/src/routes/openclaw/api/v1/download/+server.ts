import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createStoredZip,
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '$lib/server/openclaw/clawhub-compat';
import {
  buildOpenClawResponseHeaders,
  isSupportedOpenClawTag,
} from '$lib/server/openclaw/registry';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import {
  resolveOpenClawFilesForVersion,
  resolveOpenClawVersionState,
} from '$lib/server/openclaw/skill-state';
import { resolveOpenClawBundleFiles } from '$lib/server/openclaw/bundle-files';
import {
  buildOpenClawDownloadCacheKey,
  getOpenClawSelectedVersionContentToken,
  isOpenClawImmutableVersionRequest,
  resolveOpenClawBinaryCache,
} from '$lib/server/openclaw/cache';
import {
  buildSkillMetricMessage,
  enqueueSkillMetric,
} from '$lib/server/skill/metrics';

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

  const detail = await resolveSkillDetail({
    db,
    r2: platform?.env?.R2,
    request,
    locals,
    waitUntil,
    includeRecommendSkills: false,
  }, slug);
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
  const skill = detail.data.skill;
  const database = db!;

  const compatSlug = encodeClawHubCompatSlug(skill.slug);
  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug,
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
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
  const selectedVersion = versionState.selectedVersion;

  try {
    const buildZipBuffer = async () => {
      const fallbackFiles = await resolveOpenClawBundleFiles({
        skill,
        r2,
        githubToken,
      });
      const files = await resolveOpenClawFilesForVersion({
        r2,
        compatSlug,
        selectedVersion,
        fallbackFiles,
      });

      return createStoredZip(files, { modifiedAt: selectedVersion.createdAt });
    };
    const fileName = `${skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()}.zip`;
    const cached = await resolveOpenClawBinaryCache({
      cacheKey: buildOpenClawDownloadCacheKey({
        compatSlug,
        selectedVersionContentToken: getOpenClawSelectedVersionContentToken(versionState),
      }),
      load: buildZipBuffer,
      waitUntil,
      immutable: isOpenClawImmutableVersionRequest(version),
      cacheControl: detail.cacheControl,
      cacheStatus: detail.cacheStatus,
      contentType: 'application/zip',
    });

    const occurredAt = Date.now();
    if (!enqueueSkillMetric(
      platform?.env?.METRICS_QUEUE,
      buildSkillMetricMessage('download', skill.id, { occurredAt }),
      {
        waitUntil,
        onError: () => database
          .prepare(`
            INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
            VALUES (?, NULL, ?, 'download', ?)
          `)
          .bind(crypto.randomUUID(), skill.id, occurredAt)
          .run()
          .catch(() => {
            // non-critical compatibility telemetry
          }),
      }
    )) {
      const telemetryWrite = database
        .prepare(`
          INSERT INTO user_actions (id, user_id, skill_id, action_type, created_at)
          VALUES (?, NULL, ?, 'download', ?)
        `)
        .bind(crypto.randomUUID(), skill.id, occurredAt)
        .run()
        .catch(() => {
          // non-critical compatibility telemetry
        });

      if (waitUntil) {
        waitUntil(telemetryWrite);
      } else {
        void telemetryWrite;
      }
    }

    return new Response(cached.data as unknown as BodyInit, {
      headers: {
        ...cached.headers,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
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
