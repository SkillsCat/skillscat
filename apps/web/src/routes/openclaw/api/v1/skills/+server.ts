import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  buildOpenClawNextCursor,
  buildOpenClawResponseHeaders,
  getOpenClawSortSql,
  normalizeOpenClawSort,
  parseOpenClawCursor,
  parseOpenClawLimit,
  buildOpenClawStats,
  isValidOpenClawSemver,
} from '$lib/server/openclaw/registry';
import {
  buildOpenClawBrowseListCacheKey,
  getOpenClawRouteCachePolicy,
  invalidateOpenClawSkillCaches,
  resolveOpenClawJsonCache,
} from '$lib/server/openclaw/cache';
import {
  buildClawHubCompatFingerprint,
  decodeClawHubCompatSlug,
  encodeClawHubCompatSlug,
} from '$lib/server/clawhub-compat';
import { resolveOpenClawVersionState } from '$lib/server/openclaw/skill-state';
import {
  buildOpenClawFileTree,
  findOpenClawReadme,
  readOpenClawManifest,
  replaceOpenClawCurrentFiles,
  snapshotOpenClawVersionFiles,
  writeOpenClawManifest,
  type OpenClawCompatManifest,
} from '$lib/server/openclaw/compat-store';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import { canWriteSkill } from '$lib/server/permissions';
import { parseSkillSlug } from '$lib/skill-path';
import { resolveOpenClawOwnerContext } from '$lib/server/openclaw/identity';

interface SkillListRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  stars: number | null;
  downloadCount30d: number | null;
  downloadCount90d: number | null;
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
  const blocks = content
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
  const seen = new Set<string>();
  const files: Array<{ path: string; content: string; size: number }> = [];

  for (const entry of uploads) {
    if (!(entry instanceof File)) continue;
    const path = normalizeUploadPath(entry.name);
    if (!isValidUploadPath(path)) {
      throw error(400, `Invalid file path: ${entry.name || '(empty)'}`);
    }
    if (seen.has(path)) {
      throw error(400, `Duplicate file path: ${path}`);
    }
    seen.add(path);

    const content = await entry.text();
    files.push({
      path,
      content,
      size: new TextEncoder().encode(content).byteLength,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function fetchOpenClawSkillListPage(input: {
  db: D1Database;
  r2: R2Bucket | undefined;
  limit: number;
  offset: number;
  sort: ReturnType<typeof normalizeOpenClawSort>;
}): Promise<OpenClawSkillListResponse> {
  const orderBySql = getOpenClawSortSql(input.sort);
  const queryLimit = input.offset === 0 ? input.limit + 1 : input.limit;

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
        s.created_at as createdAt,
        COALESCE(s.last_commit_at, s.updated_at) as updatedAt
      FROM skills s
      WHERE s.visibility = 'public'
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?
    `)
    .bind(queryLimit, input.offset)
    .all<SkillListRow>();

  const hasMoreOnFirstPage = input.offset === 0 && result.results.length > input.limit;
  const pageRows = hasMoreOnFirstPage ? result.results.slice(0, input.limit) : result.results;

  let total: number;
  if (input.offset === 0 && !hasMoreOnFirstPage) {
    total = pageRows.length;
  } else {
    const countResult = await input.db
      .prepare(`
        SELECT COUNT(*) as total
        FROM skills
        WHERE visibility = 'public'
      `)
      .first<{ total: number }>();
    total = countResult?.total || 0;
  }

  return {
    items: await Promise.all(
      pageRows.map(async (row) => {
        const compatSlug = encodeClawHubCompatSlug(row.slug);
        const versionState = await resolveOpenClawVersionState({
          r2: input.r2,
          compatSlug,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
        });

        return {
          slug: compatSlug,
          displayName: row.name,
          summary: row.description || null,
          tags: versionState.tags,
          stats: buildOpenClawStats(row),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          latestVersion: versionState.latestVersion,
        };
      })
    ),
    nextCursor: buildOpenClawNextCursor(input.offset, input.limit, total),
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
  const cached = await resolveOpenClawJsonCache({
    cacheKey,
    load: () => fetchOpenClawSkillListPage({ db, r2, limit, offset, sort }),
    waitUntil,
    cacheControl: cachePolicy.cacheControl,
    cacheStatus: 'MISS',
  });

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
  if (!auth.userId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const formData = await request.formData();
  const rawPayload = formData.get('payload');
  if (typeof rawPayload !== 'string') {
    throw error(400, 'Multipart field "payload" is required');
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

  const nativeSlug = decodeClawHubCompatSlug(payload.slug);
  const parsedSlug = parseSkillSlug(nativeSlug);
  if (!parsedSlug) {
    throw error(400, 'slug must use the SkillsCat ClawHub compatibility format');
  }

  const ownerContext = await resolveOpenClawOwnerContext(db, auth.userId, parsedSlug.owner);
  if (!ownerContext) {
    throw error(403, 'You can only publish under your own handle or an organization you belong to');
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

  let skillId = existing?.id || crypto.randomUUID();
  if (existing) {
    if (existing.sourceType !== 'upload') {
      throw error(409, 'This slug is already reserved by a non-uploaded SkillsCat skill');
    }

    const canWrite = await canWriteSkill(existing.id, auth.userId, db);
    if (!canWrite) {
      throw error(403, 'You do not have permission to publish a new version for this skill');
    }

    await db
      .prepare(`
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
      `)
      .bind(
        displayName,
        summary,
        ownerContext.ownerHandle,
        repoName,
        skillPath,
        auth.userId,
        ownerContext.orgId,
        readme.content,
        JSON.stringify(buildOpenClawFileTree(files)),
        fingerprint,
        now,
        now,
        now,
        existing.id
      )
      .run();
  } else {
    await db
      .prepare(`
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
      `)
      .bind(
        skillId,
        displayName,
        nativeSlug,
        summary,
        ownerContext.ownerHandle,
        repoName,
        skillPath,
        JSON.stringify(buildOpenClawFileTree(files)),
        readme.content,
        now,
        auth.userId,
        ownerContext.orgId,
        fingerprint,
        now,
        now,
        now
      )
      .run();
  }

  await replaceOpenClawCurrentFiles(r2, nativeSlug, files);
  await snapshotOpenClawVersionFiles(r2, compatSlug, payload.version, files);

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

  await writeOpenClawManifest(r2, nextManifest);
  await invalidateOpenClawSkillCaches(skillId, nativeSlug);

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
};
