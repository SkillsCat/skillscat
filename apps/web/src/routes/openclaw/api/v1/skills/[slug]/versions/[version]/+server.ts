import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
  buildOpenClawVersionFiles,
} from '$lib/server/openclaw/registry';
import { decodeClawHubCompatSlug, encodeClawHubCompatSlug } from '$lib/server/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import {
  resolveOpenClawFilesForVersion,
  resolveOpenClawVersionState,
} from '$lib/server/openclaw/skill-state';
import { resolveOpenClawBundleFiles } from '$lib/server/openclaw/bundle-files';
import {
  buildOpenClawVersionDetailCacheKey,
  getOpenClawSelectedVersionMetadataToken,
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
  const skill = detail.data.skill;

  const versionState = await resolveOpenClawVersionState({
    r2: platform?.env?.R2,
    compatSlug: params.slug,
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
    requestedVersion: params.version,
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

  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;
  const buildPayload = async () => {
    const fallbackFiles = await resolveOpenClawBundleFiles({
      skill,
      r2,
      githubToken,
    });
    const versionFiles = await resolveOpenClawFilesForVersion({
      r2,
      compatSlug: params.slug,
      selectedVersion,
      fallbackFiles,
    });

    return {
      version: {
        version: selectedVersion.version,
        createdAt: selectedVersion.createdAt,
        changelog: selectedVersion.changelog,
        changelogSource: selectedVersion.changelogSource,
        license: selectedVersion.license,
        files: await buildOpenClawVersionFiles(versionFiles),
      },
      skill: {
        slug: encodeClawHubCompatSlug(skill.slug),
        displayName: skill.name,
      },
    };
  };

  const cached = await resolveOpenClawJsonCache({
    cacheKey: buildOpenClawVersionDetailCacheKey({
      compatSlug: params.slug,
      skillUpdatedAt: skill.updatedAt,
      selectedVersionMetadataToken: getOpenClawSelectedVersionMetadataToken(versionState),
    }),
    load: buildPayload,
    waitUntil,
    immutable: true,
    cacheControl: detail.cacheControl,
    cacheStatus: detail.cacheStatus,
  });

  return json(cached.data, {
    headers: cached.headers,
  });
};
