import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuthContext, requireSubmitPublishScope } from '$lib/server/middleware/auth';

const MAX_PREVIEW_BODY_BYTES = 180000;

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
  if (!auth.userId || !auth.user) {
    throw error(401, 'Authentication required');
  }
  requireSubmitPublishScope(auth);

  const payload = await readLimitedJsonBody(request, MAX_PREVIEW_BODY_BYTES) as {
    content?: string;
    org?: string;
  };

  const skillMdContent = payload.content;
  const orgSlug = payload.org;

  if (!skillMdContent || typeof skillMdContent !== 'string') {
    throw error(400, 'content field is required');
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

  // Check if org is connected to GitHub (to determine default visibility)
  let orgConnectedToGithub = false;

  if (orgSlug) {
    const org = await db.prepare(`
      SELECT o.id, o.slug, o.github_org_id FROM organizations o
      INNER JOIN org_members om ON o.id = om.org_id
      WHERE o.slug = ? AND om.user_id = ?
    `)
      .bind(orgSlug, auth.userId)
      .first<{ id: string; slug: string; github_org_id: number | null }>();

    if (!org) {
      throw error(403, 'You are not a member of this organization');
    }

    slugOwner = org.slug;
    orgConnectedToGithub = org.github_org_id !== null;
  }

  // Determine suggested visibility
  // - Org connected to GitHub: default public
  // - Org not connected: default private
  // - Personal: default private
  const suggestedVisibility = orgSlug && orgConnectedToGithub ? 'public' : 'private';

  // Generate preview slug
  const skillName = validation.name || 'untitled-skill';
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

  // Check if there's an existing public skill with the same content hash
  const contentHash = await computeContentHash(skillMdContent);
  const existingPublicByHash = await db.prepare(`
    SELECT slug FROM skills WHERE content_hash = ? AND visibility = 'public'
  `)
    .bind(contentHash)
    .first<{ slug: string }>();

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
