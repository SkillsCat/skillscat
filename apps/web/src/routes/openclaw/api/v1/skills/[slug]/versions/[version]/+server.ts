import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
  buildOpenClawVersionFiles,
} from '$lib/server/openclaw-registry';
import { decodeClawHubCompatSlug, encodeClawHubCompatSlug } from '$lib/server/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill-detail';
import { resolveSkillFiles } from '$lib/server/skill-files';
import {
  resolveOpenClawFilesForVersion,
  resolveOpenClawVersionState,
} from '$lib/server/openclaw-skill-state';

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

  const versionState = await resolveOpenClawVersionState({
    r2: platform?.env?.R2,
    compatSlug: params.slug,
    updatedAt: detail.data.skill.updatedAt,
    createdAt: detail.data.skill.createdAt,
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

  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;
  const fallbackFiles = await resolveSkillFiles(
    { db, r2, githubToken, request, locals, waitUntil },
    { slug }
  );
  const versionFiles = await resolveOpenClawFilesForVersion({
    r2,
    compatSlug: params.slug,
    selectedVersion: versionState.selectedVersion,
    fallbackFiles: fallbackFiles.data.files,
  });

  return json(
    {
      version: {
        version: versionState.selectedVersion.version,
        createdAt: versionState.selectedVersion.createdAt,
        changelog: versionState.selectedVersion.changelog,
        changelogSource: versionState.selectedVersion.changelogSource,
        license: versionState.selectedVersion.license,
        files: await buildOpenClawVersionFiles(versionFiles),
      },
      skill: {
        slug: encodeClawHubCompatSlug(detail.data.skill.slug),
        displayName: detail.data.skill.name,
      },
    },
    {
      headers: buildOpenClawResponseHeaders({
        cacheControl: fallbackFiles.cacheControl,
        cacheStatus: fallbackFiles.cacheStatus,
      }),
    }
  );
};
