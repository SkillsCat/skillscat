import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawNextCursor,
  buildOpenClawResponseHeaders,
  getOpenClawIndexHint,
  getOpenClawSortSql,
  normalizeOpenClawSort,
  parseOpenClawCursor,
  parseOpenClawLimit,
  buildOpenClawStats,
  isValidOpenClawSemver,
} from '$lib/server/openclaw/registry';
import {
  buildOpenClawBrowseListCacheKey,
  canCacheOpenClawBrowseList,
  getOpenClawRouteCachePolicy,
  invalidateOpenClawSkillCaches,
  resolveOpenClawJsonCache,
} from '$lib/server/openclaw/cache';
import {
  buildClawHubCompatFingerprint,
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '$lib/server/openclaw/clawhub-compat';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';
import {
  acquireOpenClawPublishLock,
  buildOpenClawFileTree,
  deleteOpenClawCurrentFiles,
  deleteOpenClawManifest,
  deleteOpenClawVersionFiles,
  findOpenClawReadme,
  readOpenClawCurrentFiles,
  readOpenClawManifest,
  releaseOpenClawPublishLock,
  replaceOpenClawCurrentFiles,
  snapshotOpenClawVersionFiles,
  writeOpenClawManifest,
  type OpenClawCompatManifest,
} from '$lib/server/openclaw/compat-store';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/auth/permissions';
import { invalidateCache } from '$lib/server/cache';
import { parseSkillSlug } from '$lib/skill-path';
import { resolveOpenClawOwnerContext } from '$lib/server/openclaw/identity';
import { getCurrentPublicSkillSlugs } from '$lib/server/skill/visibility';
import {
  computeBundleManifestHash,
  computeExactBundleFingerprint,
  computeSha256Hex,
  computeSkillMdHashes,
  buildSkillHashStatements,
  findSkillsByExactHashGroup,
} from '$lib/server/skill/dedup';
import { buildTouchOrganizationStatement } from '$lib/server/org/mutations';

const MAX_OPENCLAW_PUBLISH_FILES = 128;
const MAX_OPENCLAW_FILE_BYTES = 1024 * 1024;
const MAX_OPENCLAW_TOTAL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_OPENCLAW_FILE_PATH_LENGTH = 512;
const MAX_OPENCLAW_PAYLOAD_BYTES = 64 * 1024;
const MAX_OPENCLAW_TAGS = 32;
const MAX_OPENCLAW_TAG_LENGTH = 64;

interface SkillListRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  stars: number | null;
  downloadCount30d: number | null;
  downloadCount90d: number | null;
  sourceType: string;
  createdAt: number;
  updatedAt: number;
}

interface PublishPayload {
  slug: string;
  displayName?: string;
  version: string;
  changelog?: string;
  acceptLicenseTerms?: boolean;
  tags?: string[];
}

interface ExistingSkillRow {
  id: string;
  ownerId: string | null;
  orgId: string | null;
  sourceType: string;
  createdAt: number;
}

interface OpenClawSkillListResponse {
  items: Array<{
    slug: string;
    displayName: string;
    summary: string | null;
    tags: Record<string, string>;
    stats: Record<string, number>;
    createdAt: number;
    updatedAt: number;
    latestVersion: {
      version: string;
      createdAt: number;
      changelog: string;
      changelogSource: 'auto' | 'user';
      license: 'MIT-0' | null;
    };
  }>;
  nextCursor: string | null;
}

function normalizeUploadPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
}

function isValidUploadPath(value: string): boolean {
  return Boolean(
    value &&
      !value.startsWith('/') &&
      !value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  );
}

function titleCaseFromSlug(value: string): string {
  return value
    .split(/[/-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function extractMarkdownTitle(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim() || null;
    }
  }
  return null;
}

function extractMarkdownSummary(content: string): string | null {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    if (block.startsWith('#')) continue;
    if (block.startsWith('```')) continue;
    return block.replace(/\s+/g, ' ').slice(0, 280) || null;
  }

  return null;
}

async function collectUploadedFiles(formData: FormData): Promise<Array<{ path: string; content: string; size: number }>> {
  const uploads = [...formData.getAll('files'), ...formData.getAll('files[]')];
  if (uploads.length > MAX_OPENCLAW_PUBLISH_FILES) {
    throw error(413, `A maximum of ${MAX_OPENCLAW_PUBLISH_FILES} files can be published at once`);
  }

  const seen = new Set<string>();
  const files: Array<{ path: string; content: string; size: number }> = [];
  let totalBytes = 0;

  for (const entry of uploads) {
    if (!(entry instanceof File)) continue;
    const path = normalizeUploadPath(entry.name);
    if (!isValidUploadPath(path) || path.length > MAX_OPENCLAW_FILE_PATH_LENGTH) {
      throw error(400, `Invalid file path: ${entry.name || '(empty)'}`);
    }
    if (seen.has(path)) {
      throw error(400, `Duplicate file path: ${path}`);
    }
    seen.add(path);

    if (entry.size > MAX_OPENCLAW_FILE_BYTES) {
      throw error(413, `File exceeds the ${MAX_OPENCLAW_FILE_BYTES} byte limit: ${path}`);
    }
    totalBytes += entry.size;
    if (totalBytes > MAX_OPENCLAW_TOTAL_FILE_BYTES) {
      throw error(413, `Published files exceed the ${MAX_OPENCLAW_TOTAL_FILE_BYTES} byte total limit`);
    }

    const content = await entry.text();
    files.push({
      path,
      content,
      size: new TextEncoder().encode(content).byteLength,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function computeOpenClawSkillHashes(
  files: Array<{ path: string; content: string; size: number }>,
  skillMdContent: string
): Promise<{ fullHash: string; normalizedHash: string; bundleExactHash: string; bundleManifestHash: string }> {
  const { fullHash, normalizedHash } = await computeSkillMdHashes(skillMdContent);
  const bundleFiles = await Promise.all(files.map(async (file) => ({
    path: file.path,
    sha: await computeSha256Hex(file.content),
    size: file.size,
    type: 'text',
  })));

  return {
    fullHash,
    normalizedHash,
    bundleExactHash: await computeExactBundleFingerprint(bundleFiles),
    bundleManifestHash: await computeBundleManifestHash(bundleFiles, normalizedHash),
  };
}

async function rollbackOpenClawPublishArtifacts(input: {
  r2: R2Bucket;
  nativeSlug: string;
  compatSlug: string;
  version: string;
  previousCurrentFiles: Array<{ path: string; content: string }>;
  previousManifest: OpenClawCompatManifest | null;
}): Promise<void> {
  const currentFilesRollback = input.previousCurrentFiles.length > 0
    ? replaceOpenClawCurrentFiles(input.r2, input.nativeSlug, input.previousCurrentFiles)
    : deleteOpenClawCurrentFiles(input.r2, input.nativeSlug);
  const manifestRollback = input.previousManifest
    ? writeOpenClawManifest(input.r2, input.previousManifest)
    : deleteOpenClawManifest(input.r2, input.compatSlug);

  const results = await Promise.allSettled([
    currentFilesRollback,
    manifestRollback,
    deleteOpenClawVersionFiles(input.r2, input.compatSlug, input.version),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    throw failed.reason;
  }
}

async function fetchOpenClawSkillListPage(input: {
  db: D1Database;
  r2: R2Bucket | undefined;
  limit: number;
  offset: number;
  sort: ReturnType<typeof normalizeOpenClawSort>;
}): Promise<OpenClawSkillListResponse> {
  const orderBySql = getOpenClawSortSql(input.sort);
  const indexHint = getOpenClawIndexHint(input.sort);
  const queryLimit = input.limit + 1;

  const result = await input.db
    .prepare(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.description,
        s.stars,
        s.download_count_30d as downloadCount30d,
        s.download_count_90d as downloadCount90d,
        s.source_type as sourceType,
        s.created_at as createdAt,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt
      FROM skills s INDEXED BY ${indexHint}
      WHERE s.visibility = 'public'
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?
    `)
    .bind(queryLimit, input.offset)
    .all<SkillListRow>();

  const hasMore = result.results.length > input.limit;
  const pageRows = hasMore ? result.results.slice(0, input.limit) : result.results;

  return {
    items: await Promise.all(
      pageRows.map(async (row) => {
        const compatSlug = encodeClawHubCompatSlug(row.slug);
        // GitHub-backed skills never have a ClawHub publish manifest. Avoid an
        // R2 miss per browse result and derive their compatibility version
        // directly from the indexed timestamps.
        const versionState = await resolveOpenClawVersionState({
          r2: row.sourceType === 'upload' ? input.r2 : undefined,
          compatSlug,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
        });

        return {
          slug: compatSlug,
          displayName: row.name,
          summary: row.description || null,
          tags: versionState.tags,
          stats: buildOpenClawStats({
            ...row,
            versions: versionState.versions.length,
          }),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          latestVersion: versionState.latestVersion,
        };
      })
    ),
    nextCursor: buildOpenClawNextCursor(input.offset, input.limit, hasMore),
  };
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;
  if (!db) {
    return json(
      { items: [], nextCursor: null },
      {
        status: 503,
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  }

  const limit = parseOpenClawLimit(url.searchParams.get('limit'));
  const offset = parseOpenClawCursor(url.searchParams.get('cursor'));
  const sort = normalizeOpenClawSort(url.searchParams.get('sort'));
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
  const cachePolicy = getOpenClawRouteCachePolicy();
  const cacheKey = buildOpenClawBrowseListCacheKey({ sort, limit, offset });
  const canCache = canCacheOpenClawBrowseList({ limit, offset });
  let cached = await resolveOpenClawJsonCache({
    cacheKey,
    load: () => fetchOpenClawSkillListPage({ db, r2, limit, offset, sort }),
    waitUntil,
    cacheControl: canCache ? cachePolicy.cacheControl : 'no-store',
    cacheStatus: canCache ? 'MISS' : 'BYPASS',
  });

  if (cached.cacheStatus === 'HIT' && cached.data.items.length > 0) {
    const nativeSlugs = cached.data.items.map((item) => decodeClawHubCompatSlug(item.slug));
    const currentPublicSlugs = await getCurrentPublicSkillSlugs(db, nativeSlugs);
    if (currentPublicSlugs.size !== new Set(nativeSlugs).size) {
      await invalidateCache(cacheKey);
      cached = await resolveOpenClawJsonCache({
        cacheKey,
        load: () => fetchOpenClawSkillListPage({ db, r2, limit, offset, sort }),
        waitUntil,
        cacheControl: cachePolicy.cacheControl,
        cacheStatus: 'MISS',
      });
    }
  }

  return json(cached.data, {
    headers: cached.headers,
  });
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  if (!db || !r2) {
    throw error(503, 'Storage not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const formData = await request.formData();
  const rawPayload = formData.get('payload');
  if (typeof rawPayload !== 'string') {
    throw error(400, 'Multipart field "payload" is required');
  }
  if (new TextEncoder().encode(rawPayload).byteLength > MAX_OPENCLAW_PAYLOAD_BYTES) {
    throw error(413, 'Publish payload is too large');
  }

  let payload: PublishPayload;
  try {
    payload = JSON.parse(rawPayload) as PublishPayload;
  } catch {
    throw error(400, 'Invalid publish payload');
  }

  if (!payload.acceptLicenseTerms) {
    throw error(400, 'acceptLicenseTerms must be true');
  }
  if (!isValidOpenClawSemver(payload.version)) {
    throw error(400, 'version must be a valid semver string');
  }
  if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
    throw error(400, 'tags must be an array of strings');
  }
  if (
    payload.tags?.length && (
      payload.tags.length > MAX_OPENCLAW_TAGS
      || payload.tags.some((tag) => typeof tag !== 'string' || tag.trim().length > MAX_OPENCLAW_TAG_LENGTH)
    )
  ) {
    throw error(400, `tags must contain at most ${MAX_OPENCLAW_TAGS} values of ${MAX_OPENCLAW_TAG_LENGTH} characters or less`);
  }

  const nativeSlug = decodeClawHubCompatSlug(payload.slug);
  const parsedSlug = parseSkillSlug(nativeSlug);
  if (!parsedSlug) {
    throw error(400, 'slug must use the SkillsCat ClawHub compatibility format');
  }

  const ownerContext = await resolveOpenClawOwnerContext(db, auth.userId, parsedSlug.owner, auth.orgId);
  if (!ownerContext) {
    throw error(403, 'You can only publish under your own handle or an organization you belong to');
  }
  if (ownerContext.orgId && !ownerContext.orgVerifiedWithGithub) {
    throw error(403, 'Public organization skills require a verified GitHub organization');
  }

  const files = await collectUploadedFiles(formData);
  if (files.length === 0) {
    throw error(400, 'At least one text file is required');
  }

  const readme = findOpenClawReadme(files);
  if (!readme) {
    throw error(400, 'SKILL.md is required');
  }

  const compatSlug = encodeClawHubCompatSlug(nativeSlug);
  const fingerprint = await buildClawHubCompatFingerprint(files);
  const now = Date.now();
  const repoName = parsedSlug.name.split('/')[0] || parsedSlug.name;
  const skillPath = parsedSlug.name.includes('/') ? parsedSlug.name : '';
  const displayName =
    payload.displayName?.trim() ||
    extractMarkdownTitle(readme.content) ||
    titleCaseFromSlug(repoName) ||
    repoName;
  const summary = extractMarkdownSummary(readme.content);
  const fileStructure = JSON.stringify(buildOpenClawFileTree(files));
  const hashes = await computeOpenClawSkillHashes(files, readme.content);
  const publishLock = await acquireOpenClawPublishLock(r2, compatSlug);
  if (!publishLock) {
    throw error(409, 'Another publish is already in progress for this skill');
  }

  try {
    const manifest = await readOpenClawManifest(r2, compatSlug);
    if (manifest?.versions.some((entry) => entry.version === payload.version)) {
      throw error(409, `Version ${payload.version} already exists`);
    }

    const existing = await db
      .prepare(`
        SELECT
          id,
          owner_id as ownerId,
          org_id as orgId,
          source_type as sourceType,
          created_at as createdAt
        FROM skills
        WHERE slug = ?
        LIMIT 1
      `)
      .bind(nativeSlug)
      .first<ExistingSkillRow>();

    const [existingPublicByHash] = await findSkillsByExactHashGroup(
      db,
      hashes.fullHash,
      hashes.bundleExactHash,
      {
        visibility: 'public',
        excludeSkillId: existing?.id,
        limit: 1,
      }
    );

    if (existingPublicByHash) {
      throw error(409, `Identical content already exists as public skill ${existingPublicByHash.slug}`);
    }

    const skillId = existing?.id || crypto.randomUUID();
    if (existing) {
      if (existing.sourceType !== 'upload') {
        throw error(409, 'This slug is already reserved by a non-uploaded SkillsCat skill');
      }

      const canWrite = await canWriteSkill(existing.id, {
        userId: auth.userId,
        orgId: auth.orgId,
      }, db);
      if (!canWrite) {
        throw error(403, 'You do not have permission to publish a new version for this skill');
      }
    }

    const previousCurrentFiles = existing
      ? await readOpenClawCurrentFiles(r2, nativeSlug)
      : [];
    const nextManifest: OpenClawCompatManifest = {
      schemaVersion: 1,
      compatSlug,
      nativeSlug,
      ownerHandle: ownerContext.ownerHandle,
      createdAt: manifest?.createdAt || existing?.createdAt || now,
      updatedAt: now,
      deleted: false,
      deletedAt: null,
      tags: {
        ...(manifest?.tags || {}),
        ...Object.fromEntries(
          (payload.tags && payload.tags.length > 0 ? payload.tags : ['latest'])
            .map((tag) => tag.trim())
            .filter(Boolean)
            .map((tag) => [tag, payload.version])
        ),
        latest: payload.version,
      },
      versions: [
        {
          version: payload.version,
          createdAt: now,
          changelog: payload.changelog?.trim() || `Published from SkillsCat's ClawHub compatibility endpoint.`,
          changelogSource: payload.changelog?.trim() ? 'user' : 'auto',
          license: 'MIT-0',
          fingerprint,
        },
        ...(manifest?.versions || []),
      ],
    };

    const skillStatement = existing
      ? db.prepare(`
          UPDATE skills
          SET
            name = ?,
            description = ?,
            repo_owner = ?,
            repo_name = ?,
            skill_path = ?,
            visibility = 'public',
            owner_id = ?,
            org_id = ?,
            source_type = 'upload',
            readme = ?,
            file_structure = ?,
            content_hash = ?,
            last_commit_at = ?,
            updated_at = ?,
            indexed_at = ?
          WHERE id = ?
        `).bind(
          displayName,
          summary,
          ownerContext.ownerHandle,
          repoName,
          skillPath,
          auth.userId,
          ownerContext.orgId,
          readme.content,
          fileStructure,
          hashes.fullHash,
          now,
          now,
          now,
          existing.id
        )
      : db.prepare(`
          INSERT INTO skills (
            id,
            name,
            slug,
            description,
            repo_owner,
            repo_name,
            skill_path,
            github_url,
            stars,
            forks,
            trending_score,
            file_structure,
            readme,
            last_commit_at,
            visibility,
            owner_id,
            org_id,
            source_type,
            content_hash,
            created_at,
            updated_at,
            indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, ?, ?, ?, 'public', ?, ?, 'upload', ?, ?, ?, ?)
        `).bind(
          skillId,
          displayName,
          nativeSlug,
          summary,
          ownerContext.ownerHandle,
          repoName,
          skillPath,
          fileStructure,
          readme.content,
          now,
          auth.userId,
          ownerContext.orgId,
          hashes.fullHash,
          now,
          now,
          now
        );

    try {
      await snapshotOpenClawVersionFiles(r2, compatSlug, payload.version, files);
      await replaceOpenClawCurrentFiles(r2, nativeSlug, files);
      await writeOpenClawManifest(r2, nextManifest);
      await db.batch([
        skillStatement,
        ...buildSkillHashStatements(db, skillId, hashes, now),
        ...(ownerContext.orgId
          ? [buildTouchOrganizationStatement(db, ownerContext.orgId, now)]
          : []),
      ]);
    } catch (publishError) {
      console.error(`Failed to publish OpenClaw skill ${nativeSlug}:`, publishError);
      try {
        await rollbackOpenClawPublishArtifacts({
          r2,
          nativeSlug,
          compatSlug,
          version: payload.version,
          previousCurrentFiles,
          previousManifest: manifest,
        });
      } catch (rollbackError) {
        console.error(`Failed to roll back OpenClaw publish ${nativeSlug}:`, rollbackError);
      }
      throw error(500, 'Failed to publish skill atomically');
    }

    try {
      await invalidateOpenClawSkillCaches(
        skillId,
        nativeSlug,
        ownerContext.orgId ? ownerContext.ownerHandle : null,
        { owner: ownerContext.ownerHandle, name: repoName }
      );
    } catch (cacheError) {
      console.error(`Failed to invalidate OpenClaw caches for ${nativeSlug}:`, cacheError);
    }

    return json(
      {
        ok: true,
        skillId,
        versionId: `${skillId}:${payload.version}`,
      },
      {
        headers: buildOpenClawResponseHeaders({
          cacheControl: 'no-store',
          cacheStatus: 'BYPASS',
        }),
      }
    );
  } finally {
    try {
      await releaseOpenClawPublishLock(r2, publishLock);
    } catch (lockError) {
      console.error(`Failed to release OpenClaw publish lock for ${nativeSlug}:`, lockError);
    }
  }
};
