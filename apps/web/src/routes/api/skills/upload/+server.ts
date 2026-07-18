import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import { invalidateCache } from '$lib/server/cache';
import {
  getOrgPageSnapshotCacheKey,
  getSkillPageCacheInvalidationKeys,
  getSkillSourceCacheKey,
  PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
} from '$lib/server/cache/keys';
import { invalidateCategoryCaches } from '$lib/server/cache/categories';
import { buildUploadSkillR2Key } from '$lib/skill-path';
import { decodeBase64Utf8 } from '$lib/server/text/codec';
import {
  findSkillsByExactHashGroup,
  storeSkillHashes,
} from '$lib/server/skill/dedup';
import {
  buildUploadBundleFileTree,
  collectMultipartUploadBundle,
  computeUploadBundleMetadata,
} from '$lib/server/skill/upload-bundle';
import { normalizeExtractedSkillTitle, stripYamlInlineComment } from '$lib/server/skill/title';
import {
  normalizeUploadedCategorySlugs,
  resolveUploadedSkillName,
} from '$lib/server/skill/upload-metadata';
import { buildSecurityContentFingerprint } from '$lib/server/security';
import {
  buildSecurityAnalysisMessage,
  markSkillSecurityDirty,
  queueSecurityAnalysis,
} from '$lib/server/security/state';
import {
  loadIndexNowSkillTarget,
  buildIndexNowSkillUrls,
  scheduleIndexNowSubmission,
} from '$lib/server/seo/indexnow';
import { buildTouchOrganizationStatement } from '$lib/server/org/mutations';
import { invalidateOpenClawSkillCaches } from '$lib/server/openclaw/cache';

/**
 * Generate a slug from username/org and skill name
 */
function generateSlug(owner: string, name: string): string {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${owner}/${safeName}`;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  categories?: string;
  keywords?: string;
}

function readOptionalFormText(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw error(400, `${field} must be a text field`);
  }
  return value;
}

/**
 * Parse YAML frontmatter from SKILL.md content
 */
function parseSkillFrontmatter(content: string): { frontmatter: SkillFrontmatter | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];
  const frontmatter: SkillFrontmatter = {};

  // Parse name
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) frontmatter.name = stripYamlInlineComment(nameMatch[1]);

  // Parse description
  const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
  if (descMatch) frontmatter.description = descMatch[1].trim();

  // Parse category (single)
  const categoryMatch = yamlContent.match(/^category:\s*(.+)$/m);
  if (categoryMatch) frontmatter.category = categoryMatch[1].trim();

  // Parse categories (multiple)
  const categoriesMatch = yamlContent.match(/^categories:\s*(.+)$/m);
  if (categoriesMatch) frontmatter.categories = categoriesMatch[1].trim();

  // Parse keywords
  const keywordsMatch = yamlContent.match(/^keywords:\s*(.+)$/m);
  if (keywordsMatch) frontmatter.keywords = keywordsMatch[1].trim();

  return { frontmatter, body };
}

/**
 * Extract categories from frontmatter
 */
function extractCategories(frontmatter: SkillFrontmatter | null): string[] {
  if (!frontmatter) return [];

  const categories: string[] = [];

  if (frontmatter.category) {
    categories.push(...frontmatter.category.split(','));
  }

  if (frontmatter.categories) {
    categories.push(...frontmatter.categories.split(','));
  }

  return normalizeUploadedCategorySlugs(categories);
}

/**
 * Validate SKILL.md content and extract metadata
 */
function validateSkillMd(content: string): {
  valid: boolean;
  error?: string;
  name?: string;
  description?: string;
  frontmatter?: SkillFrontmatter | null;
  categories?: string[];
} {
  if (!content || content.length < 10) {
    return { valid: false, error: 'SKILL.md content is too short' };
  }

  if (content.length > 100000) {
    return { valid: false, error: 'SKILL.md content exceeds 100KB limit' };
  }

  // Check for binary content
  if (/[\x00-\x08\x0E-\x1F]/.test(content)) {
    return { valid: false, error: 'SKILL.md contains binary content' };
  }

  // Parse frontmatter
  const { frontmatter, body } = parseSkillFrontmatter(content);

  // Use frontmatter name/description if available
  let name = frontmatter?.name ? normalizeExtractedSkillTitle(frontmatter.name) : undefined;
  let description = frontmatter?.description;

  // Fallback: extract from markdown content
  if (!name) {
    const titleMatch = body.match(/^#\s+(.+)$/m);
    name = titleMatch ? normalizeExtractedSkillTitle(titleMatch[1]) : undefined;
  }

  if (!description) {
    const descMatch = body.match(/^#.+\n+(.+?)(?:\n\n|\n#|$)/s);
    description = descMatch ? descMatch[1].trim().slice(0, 500) : undefined;
  }

  // Extract categories from frontmatter
  const categories = extractCategories(frontmatter);

  return { valid: true, name, description, frontmatter, categories };
}

/**
 * GET /api/skills/upload/preview - Preview skill metadata before publishing
 * Query params: content (base64 encoded SKILL.md content), org (optional)
 */
export const GET: RequestHandler = async ({ locals, platform, request, url }) => {
  const db = platform?.env?.DB;

  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  // Get content from query params (base64 encoded)
  const contentBase64 = url.searchParams.get('content');
  let orgSlug = url.searchParams.get('org');
  const nameOverride = url.searchParams.get('name');

  if (!contentBase64) {
    throw error(400, 'content parameter is required (base64 encoded SKILL.md)');
  }

  // Protect preview endpoint from oversized query payload abuse
  if (contentBase64.length > 180000) {
    throw error(400, 'content parameter is too large');
  }

  // Decode content
  let skillMdContent: string;
  try {
    skillMdContent = decodeBase64Utf8(contentBase64);
  } catch {
    throw error(400, 'Invalid base64 content');
  }

  // Validate content
  const validation = validateSkillMd(skillMdContent);
  if (!validation.valid) {
    throw error(400, validation.error!);
  }

  // Get username for slug
  const user = auth.userId
    ? await db.prepare(`
        SELECT name FROM user WHERE id = ?
      `)
      .bind(auth.userId)
      .first<{ name: string }>()
    : null;

  const username = user?.name || auth.userId?.slice(0, 8) || 'user';

  // Determine owner context
  let slugOwner = username;

  // Check if org is connected to GitHub (to determine default visibility)
  let orgConnectedToGithub = false;

  if (auth.orgId || orgSlug) {
    const org = auth.orgId
      ? await db.prepare(`
          SELECT id, slug, github_org_id, verified_at FROM organizations WHERE id = ?
        `)
        .bind(auth.orgId)
        .first<{ id: string; slug: string; github_org_id: number | null; verified_at: number | null }>()
      : await db.prepare(`
          SELECT o.id, o.slug, o.github_org_id, o.verified_at FROM organizations o
          INNER JOIN org_members om ON o.id = om.org_id
          WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
        `)
        .bind(orgSlug, auth.userId)
        .first<{ id: string; slug: string; github_org_id: number | null; verified_at: number | null }>();

    if (!org) {
      throw error(403, 'You are not a member of this organization');
    }

    if (auth.orgId && orgSlug && org.slug.toLowerCase() !== orgSlug.toLowerCase()) {
      throw error(403, 'Organization token does not match the requested organization');
    }

    slugOwner = org.slug;
    orgSlug = org.slug;
    orgConnectedToGithub = org.github_org_id !== null && org.verified_at !== null;
  }

  // Determine suggested visibility
  // - Org connected to GitHub: default public
  // - Org not connected: default private
  // - Personal: default private
  const suggestedVisibility = orgSlug && orgConnectedToGithub ? 'public' : 'private';

  // Generate preview slug
  const skillName = resolveUploadedSkillName(nameOverride, validation.name);
  if (!skillName) {
    throw error(400, 'Skill name must be 200 characters or less and contain a letter or number');
  }
  const slug = generateSlug(slugOwner, skillName);

  // Check for duplicate slug and existing public version
  const existingSkill = await db.prepare(`
    SELECT id, visibility FROM skills WHERE slug = ?
  `)
    .bind(slug)
    .first<{ id: string; visibility: string }>();

  const warnings: string[] = [];
  let canPublishPrivate = true;

  if (existingSkill) {
    warnings.push(`A skill with slug ${slug} already exists. Publishing will fail.`);
  }

  const { hashes } = await computeUploadBundleMetadata([{
    path: 'SKILL.md',
    content: skillMdContent,
    size: new TextEncoder().encode(skillMdContent).byteLength,
  }]);
  const [existingPublicByHash] = await findSkillsByExactHashGroup(
    db,
    hashes.fullHash,
    hashes.bundleExactHash!,
    {
      visibility: 'public',
      limit: 1,
    }
  );

  if (existingPublicByHash) {
    warnings.push(`Identical content exists as public skill ${existingPublicByHash.slug}. Cannot publish as private.`);
    canPublishPrivate = false;
  }

  return json({
    success: true,
    preview: {
      name: skillName,
      slug,
      description: validation.description || null,
      categories: validation.categories || [],
      owner: slugOwner,
    },
    suggestedVisibility,
    canPublishPrivate,
    warnings,
  });
};

/**
 * POST /api/skills/upload - Upload a private skill
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const db = platform?.env?.DB;
  const r2 = platform?.env?.R2;

  if (!db || !r2) {
    throw error(500, 'Storage not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw error(400, 'Invalid multipart form data');
  }
  const skillMdFile = formData.get('skill_md');
  const name = readOptionalFormText(formData, 'name');
  const description = readOptionalFormText(formData, 'description');
  let orgSlug = readOptionalFormText(formData, 'org');
  const visibility = readOptionalFormText(formData, 'visibility') || 'private';

  // Validate visibility
  if (!['public', 'private', 'unlisted'].includes(visibility)) {
    throw error(400, 'Invalid visibility. Must be public, private, or unlisted');
  }

  // Get SKILL.md content
  let skillMdContent: string;
  if (skillMdFile instanceof File) {
    skillMdContent = await skillMdFile.text();
  } else if (typeof skillMdFile === 'string') {
    skillMdContent = skillMdFile;
  } else {
    throw error(400, 'SKILL.md file is required');
  }
  const bundleFiles = await collectMultipartUploadBundle(formData, skillMdContent);

  // Validate content
  const validation = validateSkillMd(skillMdContent);
  if (!validation.valid) {
    throw error(400, validation.error!);
  }

  // Get username for slug
  const user = auth.userId
    ? await db.prepare(`
        SELECT name FROM user WHERE id = ?
      `)
      .bind(auth.userId)
      .first<{ name: string }>()
    : null;

  const username = user?.name || auth.userId?.slice(0, 8) || null;

  // Determine owner context (user or org)
  let orgId: string | null = null;
  let slugOwner = username;
  let orgVerifiedWithGithub = false;

  if (auth.orgId || orgSlug) {
    const org = auth.orgId
      ? await db.prepare(`
          SELECT id, slug, github_org_id, verified_at FROM organizations WHERE id = ?
        `)
        .bind(auth.orgId)
        .first<{ id: string; slug: string; github_org_id: number | null; verified_at: number | null }>()
      : await db.prepare(`
          SELECT o.id, o.slug, o.github_org_id, o.verified_at FROM organizations o
          INNER JOIN org_members om ON o.id = om.org_id
          WHERE o.slug = ? COLLATE NOCASE AND om.user_id = ?
        `)
        .bind(orgSlug, auth.userId)
        .first<{ id: string; slug: string; github_org_id: number | null; verified_at: number | null }>();

    if (!org) {
      throw error(403, 'You are not a member of this organization');
    }

    if (auth.orgId && orgSlug && org.slug.toLowerCase() !== orgSlug.toLowerCase()) {
      throw error(403, 'Organization token does not match the requested organization');
    }

    orgId = org.id;
    slugOwner = org.slug;
    orgSlug = org.slug;
    orgVerifiedWithGithub = org.github_org_id !== null && org.verified_at !== null;
  }

  if (!slugOwner) {
    throw error(400, 'Unable to determine skill owner');
  }

  if (visibility === 'public' && !orgVerifiedWithGithub) {
    throw error(403, 'Public uploads require a verified GitHub organization');
  }

  // Generate skill ID and slug
  const skillId = crypto.randomUUID();
  const skillName = resolveUploadedSkillName(name, validation.name);
  if (!skillName) {
    throw error(400, 'Skill name must be 200 characters or less and contain a letter or number');
  }
  const slug = generateSlug(slugOwner, skillName);

  // Check for duplicate slug
  const existingSlug = await db.prepare(`
    SELECT id FROM skills WHERE slug = ?
  `)
    .bind(slug)
    .first();

  if (existingSlug) {
    throw error(409, `A skill with slug ${slug} already exists`);
  }

  // Compute content hash
  const bundleMetadata = await computeUploadBundleMetadata(bundleFiles);
  const { hashes } = bundleMetadata;
  const contentHash = hashes.fullHash;
  const categorySlugs = validation.categories || [];
  const r2Files = bundleFiles.map((file) => ({
    ...file,
    key: buildUploadSkillR2Key(slug, file.path),
  }));
  if (r2Files.some((file) => !file.key)) {
    throw error(400, 'Invalid skill slug');
  }
  const fileStructure = JSON.stringify(buildUploadBundleFileTree(bundleFiles));
  const [existingPublicByHash] = await findSkillsByExactHashGroup(
    db,
    hashes.fullHash,
    hashes.bundleExactHash!,
    {
      visibility: 'public',
      limit: 1,
    }
  );

  if (existingPublicByHash) {
    if (visibility === 'private') {
      throw error(409, `Cannot publish as private: identical content exists as public skill ${existingPublicByHash.slug}`);
    }

    throw error(409, `Identical content already exists as public skill ${existingPublicByHash.slug}`);
  }

  // Insert skill into database
  const now = Date.now();
  try {
    const insertSkillStatement = db.prepare(`
      INSERT INTO skills (
        id, name, slug, description, visibility, owner_id, org_id,
        source_type, readme, file_structure, content_hash, created_at, updated_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        skillId,
        skillName,
        slug,
        description || validation.description || null,
        visibility,
        auth.userId,
        orgId,
        skillMdContent,
        fileStructure,
        contentHash,
        now,
        now,
        now
      );
    if (orgId) {
      await db.batch([
        insertSkillStatement,
        buildTouchOrganizationStatement(db, orgId, now),
      ]);
    } else {
      await insertSkillStatement.run();
    }
  } catch (err) {
    const message = String(err);
    if (message.includes('skills_slug_unique') || message.includes('skills.slug')) {
      throw error(409, `A skill with slug ${slug} already exists`);
    }
    throw err;
  }

  try {
    await storeSkillHashes(db, skillId, hashes);
    if (categorySlugs.length > 0) {
      await db.batch(categorySlugs.map((categorySlug) => db.prepare(`
        INSERT INTO skill_categories (skill_id, category_slug)
        VALUES (?, ?)
        ON CONFLICT(skill_id, category_slug) DO NOTHING
      `).bind(skillId, categorySlug)));
    }
  } catch (metadataError) {
    console.error(`Failed to store upload metadata for skill ${skillId}:`, metadataError);
    try {
      await db.prepare('DELETE FROM skills WHERE id = ?').bind(skillId).run();
    } catch (rollbackError) {
      console.error(`Rollback failed for uploaded skill ${skillId}:`, rollbackError);
    }
    throw error(500, 'Failed to store skill metadata');
  }

  // Store the complete bundle in R2 after DB metadata succeeds to avoid accidental
  // overwrite during concurrent uploads that race on slug uniqueness.
  try {
    const uploadedAt = new Date().toISOString();
    const writes = await Promise.allSettled(r2Files.map((file) => r2.put(file.key!, file.content, {
      httpMetadata: {
        contentType: file.path.toLowerCase().endsWith('.md')
          ? 'text/markdown; charset=utf-8'
          : 'text/plain; charset=utf-8',
      },
      customMetadata: {
        skillId,
        uploadedBy: auth.principalId || 'unknown',
        uploadedAt,
      },
    })));
    if (writes.some((result) => result.status === 'rejected')) {
      await Promise.allSettled(r2Files.map((file) => r2.delete(file.key!)));
      throw new Error('One or more bundle files could not be stored');
    }
  } catch (err) {
    console.error(`Failed to write upload content to R2 for skill ${skillId}:`, err);
    // Roll back DB record so upload remains all-or-nothing.
    try {
      await db.prepare('DELETE FROM skills WHERE id = ?').bind(skillId).run();
    } catch (rollbackErr) {
      console.error(`Rollback failed for uploaded skill ${skillId}:`, rollbackErr);
    }
    throw error(500, 'Failed to store skill content');
  }

  try {
    const securityFingerprint = await buildSecurityContentFingerprint(bundleMetadata.manifestFiles);

    await markSkillSecurityDirty(db, {
      skillId,
      contentFingerprint: securityFingerprint,
    });
    await queueSecurityAnalysis(
      platform?.env?.SECURITY_ANALYSIS_QUEUE,
      buildSecurityAnalysisMessage(skillId, 'content_update', 'free')
    );
  } catch (securityError) {
    console.error(`Failed to enqueue security analysis for uploaded skill ${skillId}:`, securityError);
  }

  if (visibility === 'public') {
    try {
      await Promise.all([
        ...PUBLIC_DISCOVERY_PAGE_INVALIDATION_KEYS,
        getSkillSourceCacheKey(slug),
        ...(orgSlug ? [getOrgPageSnapshotCacheKey(orgSlug)] : []),
        ...getSkillPageCacheInvalidationKeys(slug),
      ].map((cacheKey) => invalidateCache(cacheKey)));

      await invalidateOpenClawSkillCaches(skillId, slug, orgSlug);

      if (categorySlugs.length > 0) {
        await invalidateCategoryCaches(categorySlugs);
      }
    } catch (cacheError) {
      console.error(`Failed to invalidate public discovery caches for uploaded skill ${skillId}:`, cacheError);
    }

    try {
      const indexNowTarget = await loadIndexNowSkillTarget(db, skillId);
      const indexNowTask = scheduleIndexNowSubmission({
        env: platform?.env,
        waitUntil: platform?.context?.waitUntil?.bind(platform.context),
        urls: indexNowTarget ? buildIndexNowSkillUrls(indexNowTarget, platform?.env) : [],
        source: `upload-skill:${slug}`,
      });

      if (indexNowTask) {
        await indexNowTask;
      }
    } catch (indexNowError) {
      console.error(`Failed to enqueue IndexNow update for uploaded skill ${skillId}:`, indexNowError);
    }
  }

  return json({
    success: true,
    skillId,
    slug,
    name: skillName,
    description: description || validation.description || null,
    categories: categorySlugs,
    message: 'Skill uploaded successfully',
  });
};
