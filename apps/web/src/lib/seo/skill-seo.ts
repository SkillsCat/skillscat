import { CATEGORIES } from '$lib/constants/categories';
import type { Category } from '$lib/constants/categories';
import type { SkillDetail } from '$lib/types';

const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((category) => [category.slug, category] as const));
const MAX_SEO_TITLE_LENGTH = 68;
const MAX_SEO_DESCRIPTION_LENGTH = 160;
const MIN_STRONG_SEO_DESCRIPTION_LENGTH = 60;
const MAX_SEO_KEYWORDS = 5;
const MAX_SEO_ARTICLE_TAGS = 3;

export interface SkillSeoPayload {
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

function cleanSummaryText(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const text = summary.replace(/\s+/g, ' ').trim();
  return text || null;
}

function buildGroundedSeoDescription(skill: SkillDetail): string {
  // `skill.description` is the canonical summary extracted from SKILL.md during indexing.
  const fromSkillDescription = cleanDescriptionText(skill.description);
  if (fromSkillDescription && fromSkillDescription.length >= MIN_STRONG_SEO_DESCRIPTION_LENGTH) {
    return trimToLength(fromSkillDescription, MAX_SEO_DESCRIPTION_LENGTH);
  }

  // Thin or missing descriptions are padded with the AI-generated functional
  // summary so the meta description (and JSON-LD) carry more unique text —
  // thin snippets are a common "crawled, not indexed" driver on detail pages.
  const summary = cleanSummaryText(skill.summary);
  if (summary) {
    const combined = fromSkillDescription ? `${fromSkillDescription} ${summary}` : summary;
    return trimToLength(combined, MAX_SEO_DESCRIPTION_LENGTH);
  }

  if (fromSkillDescription) {
    return trimToLength(fromSkillDescription, MAX_SEO_DESCRIPTION_LENGTH);
  }

  return trimToLength(`Discover ${skill.name} on SkillsCat.`, MAX_SEO_DESCRIPTION_LENGTH);
}

function getSeoRelevantCategories(skill: SkillDetail): Category[] {
  const categories = (skill.categories ?? [])
    .map((slug) => CATEGORY_BY_SLUG.get(slug))
    .filter(isCategory);

  if (categories.length === 0) {
    return [];
  }

  if (skill.classificationMethod !== 'keyword') {
    return categories;
  }

  const primaryCategory = categories[0];
  if (!primaryCategory) {
    return [];
  }

  const evidenceText = `${skill.name} ${skill.description ?? ''}`
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  const hasPrimaryCategoryEvidence =
    evidenceText.includes(primaryCategory.name.toLowerCase()) ||
    evidenceText.includes(primaryCategory.slug.replace(/-/g, ' ')) ||
    primaryCategory.keywords.some((keyword) => evidenceText.includes(keyword.toLowerCase()));

  return hasPrimaryCategoryEvidence ? [primaryCategory] : [];
}

/**
 * Keywords are limited to real, grounded terms: the skill name plus its actual
 * category names. Programmatic permutations (`<name> skill`, `<kw> automation
 * skill`, ...) read as keyword stuffing and were removed. These only feed
 * JSON-LD `keywords` now; `<meta name="keywords">` is no longer emitted
 * anywhere (ignored by Google and a spam signal).
 */
export function buildSkillSeoKeywords(skill: SkillDetail): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();

  appendKeyword(keywords, seen, skill.name);
  for (const category of getSeoRelevantCategories(skill)) {
    appendKeyword(keywords, seen, category.name);
  }

  return keywords.slice(0, MAX_SEO_KEYWORDS);
}

export function buildSkillSeoPayload(skill: SkillDetail): SkillSeoPayload {
  const categories = getSeoRelevantCategories(skill);
  const primaryCategoryName = categories[0]?.name;
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

  return {
    title,
    description,
    keywords,
    articleTags: categories.slice(0, MAX_SEO_ARTICLE_TAGS).map((category) => category.name),
    section: primaryCategoryName,
  };
}
