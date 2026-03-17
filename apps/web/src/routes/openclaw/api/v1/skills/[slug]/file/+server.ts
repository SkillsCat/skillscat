import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  guessOpenClawTextContentType,
  isSupportedOpenClawTag,
} from '$lib/server/openclaw/registry';
import { decodeClawHubCompatSlug, encodeClawHubCompatSlug } from '$lib/server/openclaw/clawhub-compat';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import {
  resolveOpenClawFilesForVersion,
  resolveOpenClawVersionState,
} from '$lib/server/openclaw/skill-state';
import { resolveOpenClawBundleFiles } from '$lib/server/openclaw/bundle-files';
import {
  buildOpenClawFileCacheKey,
  getOpenClawSelectedVersionContentToken,
  isOpenClawImmutableVersionRequest,
  resolveOpenClawTextCache,
} from '$lib/server/openclaw/cache';

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
  const skill = detail.data.skill;
  const versionState = await resolveOpenClawVersionState({
    r2,
    compatSlug: encodeClawHubCompatSlug(skill.slug),
    updatedAt: skill.updatedAt,
    createdAt: skill.createdAt,
    requestedVersion: version,
    requestedTag: tag,
  });

  if (!versionState.selectedVersion) {
    throw error(404, 'Requested version is not available.');
  }
  const selectedVersion = versionState.selectedVersion;

  const compatSlug = encodeClawHubCompatSlug(skill.slug);
  const contentType = guessOpenClawTextContentType(path);
  const buildFileContent = async () => {
    const githubToken = platform?.env?.GITHUB_TOKEN;
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

    const matched = files.find((file) => file.path === path);
    if (!matched) {
      throw error(404, 'File not found.');
    }

    return matched.content;
  };

  const cached = await resolveOpenClawTextCache({
    cacheKey: buildOpenClawFileCacheKey({
      compatSlug,
      path,
      selectedVersionContentToken: getOpenClawSelectedVersionContentToken(versionState),
    }),
    load: buildFileContent,
    waitUntil,
    immutable: isOpenClawImmutableVersionRequest(version),
    cacheControl: detail.cacheControl,
    cacheStatus: detail.cacheStatus,
  });

  return new Response(cached.data, {
    headers: {
      ...cached.headers,
      'Content-Type': contentType,
    },
  });
};
