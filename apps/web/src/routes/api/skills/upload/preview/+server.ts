import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/auth/middleware';
import {
  findSkillsByExactHashGroup,
} from '$lib/server/skill/dedup';
import {
  collectPreviewUploadBundle,
  computeUploadBundleMetadata,
  MAX_UPLOAD_BUNDLE_TOTAL_BYTES,
} from '$lib/server/skill/upload-bundle';
import { normalizeExtractedSkillTitle, stripYamlInlineComment } from '$lib/server/skill/title';
import {
  normalizeUploadedCategorySlugs,
  resolveUploadedSkillName,
} from '$lib/server/skill/upload-metadata';

const MAX_PREVIEW_BODY_BYTES = (MAX_UPLOAD_BUNDLE_TOTAL_BYTES * 2) + (256 * 1024);

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

  return { valid: true, name, description, categories };
}

/**
 * Read request body with a hard size limit and parse JSON.
 */
async function readLimitedJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw error(413, 'Request body too large');
    }
  }

  const body = request.body;
  if (!body) {
    throw error(400, 'Request body is required');
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      reader.cancel().catch(() => {});
      throw error(413, 'Request body too large');
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw error(400, 'Invalid JSON body');
  }
}

/**
 * POST /api/skills/upload/preview - Preview skill metadata before publishing.
 * Body: { content: string, org?: string }
 */
export const POST: RequestHandler = async ({ locals, platform, request }) => {
  const db = platform?.env?.DB;

  if (!db) {
    throw error(500, 'Database not available');
  }

  const auth = await getAuthContext(request, locals, db);
  if (!auth.userId && !auth.orgId) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const payload = await readLimitedJsonBody(request, MAX_PREVIEW_BODY_BYTES) as {
    content?: string;
    org?: string;
    name?: string;
    files?: unknown;
  };

  const skillMdContent = payload.content;
  let orgSlug = payload.org;

  if (!skillMdContent || typeof skillMdContent !== 'string') {
    throw error(400, 'content field is required');
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

  const username = user?.name || auth.userId?.slice(0, 8) || null;

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

  if (!slugOwner) {
    throw error(400, 'Unable to determine skill owner');
  }

  // Determine suggested visibility
  // - Org connected to GitHub: default public
  // - Org not connected: default private
  // - Personal: default private
  const suggestedVisibility = orgSlug && orgConnectedToGithub ? 'public' : 'private';

  // Generate preview slug
  const skillName = resolveUploadedSkillName(payload.name, validation.name);
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
  let canPublishPublic = true;

  if (existingSkill) {
    warnings.push(`A skill with slug ${slug} already exists. Publishing will fail.`);
    canPublishPublic = false;
  }

  const bundleFiles = collectPreviewUploadBundle(payload.files, skillMdContent);
  const { hashes } = await computeUploadBundleMetadata(bundleFiles);
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
    warnings.push(`Identical content already exists as public skill ${existingPublicByHash.slug}. Publishing another copy will fail.`);
    canPublishPrivate = false;
    canPublishPublic = false;
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
    canPublishPublic,
    warnings,
  });
};
