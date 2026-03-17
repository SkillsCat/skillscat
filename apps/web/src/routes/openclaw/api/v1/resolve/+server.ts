import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildClawHubCompatFingerprint,
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '$lib/server/openclaw/clawhub-compat';
import {
  buildOpenClawLatestVersion,
  buildOpenClawResponseHeaders,
} from '$lib/server/openclaw/registry';
import { resolveSkillDetail } from '$lib/server/skill/detail';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';
import { resolveOpenClawBundleFiles } from '$lib/server/openclaw/bundle-files';
import {
  buildOpenClawResolveCacheKey,
  getOpenClawVersionsStateToken,
  resolveOpenClawJsonCache,
} from '$lib/server/openclaw/cache';

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export const GET: RequestHandler = async ({ url, platform, request, locals }) => {
  const slug = decodeClawHubCompatSlug(url.searchParams.get('slug') ?? '');
  const hash = (url.searchParams.get('hash') ?? '').trim();

  if (!slug || !hash) {
    return json(
      { error: 'Query parameters "slug" and "hash" are required.' },
      {
        status: 400,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }
  if (!isSha256Hex(hash)) {
    return json(
      { error: 'Query parameter "hash" must be a 64-character sha256 hex string.' },
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
  const skill = detail.data.skill;

  try {
    const compatSlug = encodeClawHubCompatSlug(skill.slug);
    const versionState = await resolveOpenClawVersionState({
      r2,
      compatSlug,
      updatedAt: skill.updatedAt,
      createdAt: skill.createdAt,
    });

    const buildPayload = async () => {
      const manifestMatch = versionState.versions.find((entry) => entry.fingerprint === hash) || null;
      if (manifestMatch) {
        return {
          slug: compatSlug,
          match: { version: manifestMatch.version },
          latestVersion: { version: versionState.latestVersion.version },
        };
      }

      const files = await resolveOpenClawBundleFiles({
        skill,
        r2,
        githubToken,
      });
      const fingerprint = await buildClawHubCompatFingerprint(files);
      const latestVersion = versionState.latestVersion || buildOpenClawLatestVersion({
        updatedAt: skill.updatedAt,
        createdAt: skill.updatedAt,
      });

      return {
        slug: compatSlug,
        match: fingerprint === hash ? { version: latestVersion.version } : null,
        latestVersion: { version: latestVersion.version },
      };
    };

    const cached = await resolveOpenClawJsonCache({
      cacheKey: buildOpenClawResolveCacheKey({
        compatSlug,
        hash,
        skillUpdatedAt: skill.updatedAt,
        versionsStateToken: getOpenClawVersionsStateToken(versionState),
      }),
      load: buildPayload,
      waitUntil,
      cacheControl: detail.cacheControl,
      cacheStatus: detail.cacheStatus,
    });

    return json(cached.data, {
      headers: cached.headers,
    });
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : 'Failed to resolve bundle version.';
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
