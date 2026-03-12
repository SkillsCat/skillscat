import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawResponseHeaders,
  guessOpenClawTextContentType,
  isSupportedOpenClawTag,
} from '$lib/server/openclaw-registry';
import { decodeClawHubCompatSlug } from '$lib/server/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill-detail';
import {
  resolveOpenClawFilesForVersion,
  resolveOpenClawVersionState,
} from '$lib/server/openclaw-skill-state';
import { resolveOpenClawBundleFiles } from '$lib/server/openclaw-bundle-files';

export const GET: RequestHandler = async ({ params, platform, request, locals, url }) => {
  const slug = decodeClawHubCompatSlug(params.slug);
  const path = (url.searchParams.get('path') ?? '').trim();
  const version = url.searchParams.get('version');
  const tag = url.searchParams.get('tag');

  if (!slug) {
    throw error(400, 'Invalid compatibility slug.');
  }
  if (!path) {
    throw error(400, 'Query parameter "path" is required.');
  }
  if (path.includes('..') || path.startsWith('/')) {
    throw error(400, 'Invalid file path.');
  }
  if (!isSupportedOpenClawTag(tag)) {
    throw error(404, 'Requested tag is not available.');
  }

  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const detail = await resolveSkillDetail({ db, request, locals, waitUntil }, slug);

  if (!detail.data) {
    throw error(detail.status, detail.error || 'Skill not found.');
  }
  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug: params.slug,
    updatedAt: detail.data.skill.updatedAt,
    createdAt: detail.data.skill.createdAt,
    requestedVersion: version,
    requestedTag: tag,
  });

  if (!versionState.selectedVersion) {
    throw error(404, 'Requested version is not available.');
  }

  const githubToken = platform?.env?.GITHUB_TOKEN;
  const fallbackFiles = await resolveOpenClawBundleFiles({
    skill: detail.data.skill,
    r2,
    githubToken,
  });
  const files = await resolveOpenClawFilesForVersion({
    r2,
    compatSlug: params.slug,
    selectedVersion: versionState.selectedVersion,
    fallbackFiles,
  });

  const matched = files.find((file) => file.path === path);
  if (!matched) {
    throw error(404, 'File not found.');
  }

  return new Response(matched.content, {
    headers: {
      ...buildOpenClawResponseHeaders({
        cacheControl: detail.cacheControl,
        cacheStatus: detail.cacheStatus,
      }),
      'Content-Type': guessOpenClawTextContentType(matched.path),
    },
  });
};
