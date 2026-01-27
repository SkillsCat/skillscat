import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext } from '$lib/server/middleware/auth';

/**
 * Compute SHA-256 hash of content
 */
async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a slug from username/org and skill name
 */
function generateSlug(owner: string, name: string): string {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `@${owner}/${safeName}`;
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
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];
  const frontmatter: SkillFrontmatter = {};

  // Parse name
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  if (nameMatch) frontmatter.name = nameMatch[1].trim();

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
    categories.push(...frontmatter.category.split(',').map(c => c.trim().toLowerCase()));
  }

  if (frontmatter.categories) {
    categories.push(...frontmatter.categories.split(',').map(c => c.trim().toLowerCase()));
  }

  return [...new Set(categories)].filter(Boolean);
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
  let name = frontmatter?.name;
  let description = frontmatter?.description;

  // Fallback: extract from markdown content
  if (!name) {
    const titleMatch = body.match(/^#\s+(.+)$/m);
    name = titleMatch ? titleMatch[1].trim() : undefined;
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
  if (!auth.userId || !auth.user) {
    throw error(401, 'Authentication required');
  }

  // Get content from query params (base64 encoded)
  const contentBase64 = url.searchParams.get('content');
  const orgSlug = url.searchParams.get('org');

  if (!contentBase64) {
    throw error(400, 'content parameter is required (base64 encoded SKILL.md)');
  }

  // Decode content
  let skillMdContent: string;
  try {
    skillMdContent = atob(contentBase64);
  } catch {
    throw error(400, 'Invalid base64 content');
  }

  // Validate content
  const validation = validateSkillMd(skillMdContent);
  if (!validation.valid) {
    throw error(400, validation.error!);
  }

  // Get username for slug
  const user = await db.prepare(`
    SELECT name FROM user WHERE id = ?
  `)
    .bind(auth.userId)
    .first<{ name: string }>();

  const username = user?.name || auth.userId.slice(0, 8);

  // Determine owner context
  let slugOwner = username;

  if (orgSlug) {
    const org = await db.prepare(`
      SELECT o.id, o.slug FROM organizations o
      INNER JOIN org_members om ON o.id = om.org_id
      WHERE o.slug = ? AND om.user_id = ?
    `)
      .bind(orgSlug, auth.userId)
      .first<{ id: string; slug: string }>();

    if (!org) {
      throw error(403, 'You are not a member of this organization');
    }

    slugOwner = org.slug;
  }

  // Generate preview slug
  const skillName = validation.name || 'untitled-skill';
  const slug = generateSlug(slugOwner, skillName);

  // Check for duplicate slug
  const existingSlug = await db.prepare(`
    SELECT id FROM skills WHERE slug = ?
  `)
    .bind(slug)
    .first();

  const warnings: string[] = [];
  if (existingSlug) {
    warnings.push(`A skill with slug ${slug} already exists. Publishing will fail.`);
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
  if (!auth.userId || !auth.user) {
    throw error(401, 'Authentication required');
  }

  // Parse multipart form data
  const formData = await request.formData();
  const skillMdFile = formData.get('skill_md');
  const name = formData.get('name') as string | null;
  const description = formData.get('description') as string | null;
  const orgSlug = formData.get('org') as string | null;
  const visibility = (formData.get('visibility') as string) || 'private';

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

  // Validate content
  const validation = validateSkillMd(skillMdContent);
  if (!validation.valid) {
    throw error(400, validation.error!);
  }

  // Get username for slug
  const user = await db.prepare(`
    SELECT name FROM user WHERE id = ?
  `)
    .bind(auth.userId)
    .first<{ name: string }>();

  const username = user?.name || auth.userId.slice(0, 8);

  // Determine owner context (user or org)
  let orgId: string | null = null;
  let slugOwner = username;

  if (orgSlug) {
    // Verify user is member of the org
    const org = await db.prepare(`
      SELECT o.id, o.slug FROM organizations o
      INNER JOIN org_members om ON o.id = om.org_id
      WHERE o.slug = ? AND om.user_id = ?
    `)
      .bind(orgSlug, auth.userId)
      .first<{ id: string; slug: string }>();

    if (!org) {
      throw error(403, 'You are not a member of this organization');
    }

    orgId = org.id;
    slugOwner = org.slug;
  }

  // Generate skill ID and slug
  const skillId = crypto.randomUUID();
  const skillName = name || validation.name || 'untitled-skill';
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
  const contentHash = await computeContentHash(skillMdContent);

  // Store SKILL.md in R2
  const r2Path = `skills/${slugOwner}/${skillName}/SKILL.md`;
  await r2.put(r2Path, skillMdContent, {
    httpMetadata: { contentType: 'text/markdown' },
    customMetadata: {
      skillId,
      uploadedBy: auth.userId,
      uploadedAt: new Date().toISOString(),
    },
  });

  // Insert skill into database
  const now = Date.now();
  await db.prepare(`
    INSERT INTO skills (
      id, name, slug, description, visibility, owner_id, org_id,
      source_type, content_hash, created_at, updated_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, ?)
  `)
    .bind(
      skillId,
      skillName,
      slug,
      description || validation.description || null,
      visibility,
      auth.userId,
      orgId,
      contentHash,
      now,
      now,
      now
    )
    .run();

  return json({
    success: true,
    skillId,
    slug,
    name: skillName,
    description: description || validation.description || null,
    categories: validation.categories || [],
    message: 'Skill uploaded successfully',
  });
};
