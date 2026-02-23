import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSkillBySlug, getRelatedSkills, recordSkillAccess } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { renderReadmeMarkdown } from '$lib/server/markdown';
import { setPublicPageCache } from '$lib/server/page-cache';
import { CATEGORIES } from '$lib/constants/categories';
import type { Category } from '$lib/constants/categories';
import { buildSkillPathFromOwnerAndName, buildSkillSlug, normalizeSkillName, normalizeSkillOwner } from '$lib/skill-path';
import type { SkillDetail } from '$lib/types';

const BOT_UA_PATTERN = /\b(bot|crawler|spider|slurp|preview|headless|lighthouse)\b/i;
const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((category) => [category.slug, category] as const));
const SEO_DESCRIPTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with',
  'you', 'your', 'ai', 'agent', 'skill', 'skills'
]);
const MAX_SEO_DESCRIPTION_SCAN_CHARS = 500;
const MAX_SEO_TITLE_LENGTH = 68;
const MAX_SEO_DESCRIPTION_LENGTH = 160;
const README_SEO_MIN_DESC_LENGTH = 32;

interface SkillSeoPayload {
  title: string;
  description: string;
  keywords: string[];
  articleTags: string[];
  section?: string;
}

function normalizeKeywordValue(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, ' ');
}

function appendKeyword(target: string[], seen: Set<string>, keyword: string): void {
  const value = keyword.trim();
  const normalized = normalizeKeywordValue(value);
  if (!normalized || normalized.length < 2 || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(value);
}

function isCategory(value: Category | undefined): value is Category {
  return Boolean(value);
}

function extractDescriptionKeywords(description: string | null | undefined): string[] {
  if (!description) return [];

  const scanText = description.slice(0, MAX_SEO_DESCRIPTION_SCAN_CHARS).toLowerCase();
  const tokens = scanText.match(/[a-z0-9][a-z0-9+#.-]*/g) || [];
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (SEO_DESCRIPTION_STOP_WORDS.has(token)) continue;
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 4)
    .map(([token]) => token);
}

function trimToLength(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const sliced = normalized.slice(0, maxLength - 1);
  const cut = sliced.lastIndexOf(' ');
  return `${(cut > Math.floor(maxLength * 0.6) ? sliced.slice(0, cut) : sliced).trim()}…`;
}

function cleanDescriptionText(description: string | null | undefined): string | null {
  if (!description) return null;
  const text = description
    .replace(/\s+/g, ' ')
    .replace(/[`*_#]/g, '')
    .trim();
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function stripMarkdownFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const match = markdown.match(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/);
  return match ? markdown.slice(match[0].length) : markdown;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyBadReadmeBlock(block: string): boolean {
  const normalized = block.trim().toLowerCase();
  if (!normalized) return true;

  if (/^(installation|install|usage|examples?|quick start|getting started|requirements?|license|contributing|author)\b/.test(normalized)) {
    return true;
  }

  if (/^(npx|npm|pnpm|yarn|uv|pip|python|node|go|cargo|docker)\b/.test(normalized)) {
    return true;
  }

  if (/^(#|>|- |\* |\d+\. )/.test(normalized) && normalized.length < README_SEO_MIN_DESC_LENGTH) {
    return true;
  }

  return false;
}

function extractReadmeSeoDescription(readme: string | null | undefined): string | null {
  if (!readme) return null;

  const withoutFrontmatter = stripMarkdownFrontmatter(readme).replace(/\r/g, '');
  const blocks = withoutFrontmatter
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const rawBlock of blocks) {
    if (!rawBlock) continue;
    if (/^\s*#{1,6}\s+/.test(rawBlock)) continue; // headings only
    if (/shields\.io|img\.shields\.io/i.test(rawBlock)) continue; // badge rows

    const plain = markdownToPlainText(rawBlock)
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s*/, '')
      .trim();

    if (plain.length < README_SEO_MIN_DESC_LENGTH) continue;
    if (!/[a-zA-Z]/.test(plain)) continue;
    if (isLikelyBadReadmeBlock(plain)) continue;

    return cleanDescriptionText(plain);
  }

  return null;
}

function buildGroundedSeoDescription(skill: SkillDetail): string {
  const fromReadme = extractReadmeSeoDescription(skill.readme);
  if (fromReadme) {
    return trimToLength(fromReadme, MAX_SEO_DESCRIPTION_LENGTH);
  }

  const fromSkillDescription = cleanDescriptionText(skill.description);
  if (fromSkillDescription) {
    return trimToLength(fromSkillDescription, MAX_SEO_DESCRIPTION_LENGTH);
  }

  return trimToLength(`Discover ${skill.name} on SkillsCat.`, MAX_SEO_DESCRIPTION_LENGTH);
}

function buildSkillSeoKeywords(skill: SkillDetail): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  const categories = (skill.categories ?? [])
    .map((slug) => CATEGORY_BY_SLUG.get(slug))
    .filter(isCategory);
  const descriptionKeywords = extractDescriptionKeywords(skill.description);
  const primaryCategory = categories[0];
  const primaryCategoryName = primaryCategory?.name?.toLowerCase();

  appendKeyword(keywords, seen, skill.name);
  appendKeyword(keywords, seen, `${skill.name} skill`);
  appendKeyword(keywords, seen, `${skill.name} ai agent skill`);
  appendKeyword(keywords, seen, skill.slug);

  if (skill.repoOwner && skill.repoName) {
    appendKeyword(keywords, seen, `${skill.repoOwner}/${skill.repoName}`);
    appendKeyword(keywords, seen, `${skill.repoOwner} ${skill.repoName}`);
    appendKeyword(keywords, seen, `${skill.repoOwner}/${skill.repoName} skill`);
  } else if (skill.repoOwner) {
    appendKeyword(keywords, seen, skill.repoOwner);
  }

  for (const category of categories) {
    appendKeyword(keywords, seen, category.name);
    appendKeyword(keywords, seen, `${category.name} skill`);
    appendKeyword(keywords, seen, `${category.name} automation skill`);
    appendKeyword(keywords, seen, `${category.name} ai agent skill`);
    for (const keyword of category.keywords.slice(0, 3)) {
      appendKeyword(keywords, seen, keyword);
      appendKeyword(keywords, seen, `${keyword} automation skill`);
      if (primaryCategoryName) {
        appendKeyword(keywords, seen, `${keyword} ${primaryCategoryName} workflow`);
      }
    }
  }

  for (const keyword of descriptionKeywords) {
    appendKeyword(keywords, seen, keyword);
    appendKeyword(keywords, seen, `${keyword} skill`);
    appendKeyword(keywords, seen, `${keyword} automation`);
  }

  if (descriptionKeywords.length >= 2) {
    appendKeyword(keywords, seen, `${descriptionKeywords[0]} ${descriptionKeywords[1]} skill`);
    appendKeyword(keywords, seen, `${descriptionKeywords[0]} ${descriptionKeywords[1]} workflow`);
  }

  if (primaryCategoryName && descriptionKeywords[0]) {
    appendKeyword(keywords, seen, `${descriptionKeywords[0]} ${primaryCategoryName} skill`);
  }

  appendKeyword(keywords, seen, skill.sourceType === 'upload' ? 'uploaded ai skill' : 'github ai skill');
  appendKeyword(keywords, seen, 'ai agent skill');
  appendKeyword(keywords, seen, 'skillscat');

  return keywords.slice(0, 24);
}

function buildSkillSeoPayload(skill: SkillDetail): SkillSeoPayload {
  const categories = (skill.categories ?? [])
    .map((slug) => CATEGORY_BY_SLUG.get(slug))
    .filter(isCategory);
  const primaryCategory = categories[0];
  const primaryCategoryName = primaryCategory?.name;
  const descriptionKeywords = extractDescriptionKeywords(skill.description);
  const keywords = buildSkillSeoKeywords(skill);

  const titleParts = [skill.name];
  if (primaryCategoryName) {
    titleParts.push(`${primaryCategoryName} AI Agent Skill`);
  } else {
    titleParts.push('AI Agent Skill');
  }
  titleParts.push('SkillsCat');
  const rawTitle = titleParts.join(' | ');
  const title = trimToLength(rawTitle, MAX_SEO_TITLE_LENGTH);

  const description = buildGroundedSeoDescription(skill);

  const articleTags: string[] = [];
  const articleTagSeen = new Set<string>();
  const pushArticleTag = (value: string) => {
    const normalized = normalizeKeywordValue(value);
    if (!normalized || articleTagSeen.has(normalized)) return;
    articleTagSeen.add(normalized);
    articleTags.push(value);
  };

  if (primaryCategoryName) pushArticleTag(primaryCategoryName);
  for (const category of categories.slice(0, 3)) {
    pushArticleTag(category.name);
    for (const keyword of category.keywords.slice(0, 2)) {
      pushArticleTag(keyword);
    }
  }
  for (const keyword of descriptionKeywords.slice(0, 3)) {
    pushArticleTag(keyword);
  }

  return {
    title,
    description,
    keywords,
    articleTags: articleTags.slice(0, 10),
    section: primaryCategoryName,
  };
}

function shouldTrackAccess(request: Request): boolean {
  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''}`.toLowerCase();
  if (purpose.includes('prefetch')) {
    return false;
  }

  const ua = (request.headers.get('user-agent') || '').trim();
  if (!ua) {
    return false;
  }

  return !BOT_UA_PATTERN.test(ua);
}

function getAccessClientKey(request: Request, userId: string | null): string | undefined {
  if (userId) {
    return `user:${userId}`;
  }

  const ua = (request.headers.get('user-agent') || '').slice(0, 64);
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return ua ? `ipua:${cfIp}:${ua}` : `ip:${cfIp}`;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return ua ? `ipua:${first}:${ua}` : `ip:${first}`;
    }
  }

  return ua ? `ua:${ua}` : undefined;
}

/**
 * Multi-segment skill detail page: /skills/[owner]/[...name]
 *
 * This route handles URLs like:
 * - /skills/testowner/testrepo
 * - /skills/testowner/testrepo/sub-skill
 *
 * with unified slug format: owner/name...
 */
export const load: PageServerLoad = async ({ params, platform, locals, request, setHeaders, cookies }) => {
  setPublicPageCache({
    setHeaders,
    request,
    isAuthenticated: Boolean(locals.user),
    hasCookies: cookies.getAll().length > 0,
    sMaxAge: 120,
    staleWhileRevalidate: 600,
  });

  const env = {
    DB: platform?.env?.DB,
    R2: platform?.env?.R2,
    KV: platform?.env?.KV,
  };

  const userId = locals.user?.id || null;

  const normalizedOwner = normalizeSkillOwner(params.owner);
  const normalizedName = normalizeSkillName(params.name);
  if (!normalizedOwner) {
    setHeaders({ 'X-Skillscat-Status-Override': '404' });
    return {
      skill: null,
      relatedSkills: [],
      error: 'Skill not found or you do not have permission to view it.',
    };
  }

  if (!normalizedName) {
    setHeaders({ 'X-Skillscat-Status-Override': '404' });
    return {
      skill: null,
      relatedSkills: [],
      error: 'Skill not found or you do not have permission to view it.',
    };
  }

  if (normalizedOwner !== params.owner || normalizedName !== params.name) {
    throw redirect(308, buildSkillPathFromOwnerAndName(normalizedOwner, normalizedName));
  }

  const slug = buildSkillSlug(normalizedOwner, normalizedName);

  try {
    const skill = await getSkillBySlug(env, slug, userId);

    if (!skill) {
      setHeaders({ 'X-Skillscat-Status-Override': '404' });
      return {
        skill: null,
        relatedSkills: [],
        error: 'Skill not found or you do not have permission to view it.',
      };
    }

    // Record access asynchronously (don't block response)
    if (skill.visibility === 'public' && shouldTrackAccess(request)) {
      recordSkillAccess(env, skill.id, getAccessClientKey(request, userId)).catch((err) => {
        console.error('Failed to record skill access:', err);
      });
    }

    // Get related skills based on categories (multi-signal scoring, cached 1h)
    const { data: relatedSkills } = await getCached(
      `related:${skill.id}`,
      () => getRelatedSkills(env, skill.id, skill.categories || [], skill.repoOwner || '', 10),
      3600
    );

    let renderedReadme = '';
    if (skill.readme) {
      if (skill.visibility === 'public') {
        const readmeVersion = skill.updatedAt ?? skill.indexedAt ?? 0;
        const { data } = await getCached(
          `readme:html:${skill.id}:${readmeVersion}`,
          () => Promise.resolve(renderReadmeMarkdown(skill.readme)),
          3600
        );
        renderedReadme = data;
      } else {
        renderedReadme = renderReadmeMarkdown(skill.readme);
      }
    }

    // Check if user has bookmarked this skill
    let isBookmarked = false;
    if (userId && env.DB) {
      const bookmark = await env.DB.prepare(
        'SELECT 1 FROM favorites WHERE user_id = ? AND skill_id = ?'
      ).bind(userId, skill.id).first();
      isBookmarked = !!bookmark;
    }

    // Determine if this is a dot-folder skill (e.g., .claude/SKILL.md)
    const isDotFolderSkill = skill.skillPath ? /^\.[\w-]+/.test(skill.skillPath) : false;
    const seo = buildSkillSeoPayload(skill);

    return {
      skill,
      renderedReadme,
      relatedSkills,
      isOwner: skill.ownerId === userId,
      isBookmarked,
      isAuthenticated: !!userId,
      isDotFolderSkill,
      seo,
    };
  } catch (error) {
    console.error('Error loading skill:', error);
    return {
      skill: null,
      relatedSkills: [],
      error: 'Failed to load skill',
    };
  }
};
