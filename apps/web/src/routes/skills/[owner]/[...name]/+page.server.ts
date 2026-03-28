import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSkillBySlug, getRecommendedSkills, loadSkillReadmeFromR2 } from '$lib/server/db/utils';
import { getCached } from '$lib/server/cache';
import { renderReadmeMarkdown } from '$lib/server/text/markdown';
import { setPublicPageCache } from '$lib/server/cache/page';
import { CATEGORIES } from '$lib/constants/categories';
import type { Category } from '$lib/constants/categories';
import { buildSkillPathFromOwnerAndName, buildSkillSlug, encodeSkillSlugForPath, normalizeSkillName, normalizeSkillOwner } from '$lib/skill-path';
import type { SkillCardData, SkillDetail } from '$lib/types';
import { buildSkillInstallData } from '$lib/skill-install';

const PUBLIC_SKILL_HTML_CACHE_HEADER = 'X-Skillscat-Public-Skill-Cache';
const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((category) => [category.slug, category] as const));
const SEO_DESCRIPTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with',
  'you', 'your', 'ai', 'agent', 'skill', 'skills'
]);
const MAX_SEO_DESCRIPTION_SCAN_CHARS = 500;
const MAX_SEO_TITLE_LENGTH = 68;
const MAX_SEO_DESCRIPTION_LENGTH = 160;
const RECOMMEND_SKILLS_CACHE_TTL = 3600;
// Keyed by skill ID + readme version, so entries are immutable after a skill update.
const README_HTML_CACHE_TTL = 60 * 60 * 24 * 30;

interface SkillSeoPayload {
  title: string;
  description: string;
  keywords: string[];
  articleTags: string[];
  section?: string;
}

type SkillPageErrorKind = 'not_found' | 'temporary_failure';

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

function buildGroundedSeoDescription(skill: SkillDetail): string {
  // `skill.description` is the canonical summary extracted from SKILL.md during indexing.
  const fromSkillDescription = cleanDescriptionText(skill.description);
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

function buildSkillSeoKeywords(skill: SkillDetail): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();
  const categories = getSeoRelevantCategories(skill);
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
  const categories = getSeoRelevantCategories(skill);
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

/**
 * Multi-segment skill detail page: /skills/[owner]/[...name]
 *
 * This route handles URLs like:
 * - /skills/testowner/testrepo
 * - /skills/testowner/testrepo/sub-skill
 *
 * with unified slug format: owner/name...
 */
export const load: PageServerLoad = async ({ params, platform, locals, request, fetch, setHeaders, isDataRequest }) => {
  const perfStart = performance.now();
  const serverTimings: Array<{ name: string; dur: number; desc?: string }> = [];
  let serverTimingFlushed = false;

  const pushTiming = (name: string, start: number, desc?: string) => {
    serverTimings.push({
      name,
      dur: Math.max(0, performance.now() - start),
      desc,
    });
  };

  const timed = async <T>(name: string, fn: () => Promise<T>, desc?: string): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      pushTiming(name, start, desc);
    }
  };

  const flushServerTiming = () => {
    if (serverTimingFlushed) return;
    serverTimingFlushed = true;
    serverTimings.push({
      name: 'total',
      dur: Math.max(0, performance.now() - perfStart),
      desc: isDataRequest ? 'data' : 'html',
    });
    setHeaders({
      'Server-Timing': serverTimings
        .map((entry) => {
          const dur = Number(entry.dur.toFixed(1));
          const descPart = entry.desc ? `;desc="${entry.desc.replace(/"/g, '')}"` : '';
          return `${entry.name};dur=${dur}${descPart}`;
        })
        .join(', '),
    });
  };

  const finish = <T>(value: T): T => {
    flushServerTiming();
    return value;
  };

  const createNotFoundResult = () => ({
    skill: null,
    recommendSkills: [] as SkillCardData[],
    error: 'Skill not found or you do not have permission to view it.',
    errorKind: 'not_found' as SkillPageErrorKind,
  });

  const createTemporaryFailureResult = () => ({
    skill: null,
    recommendSkills: [] as SkillCardData[],
    error: 'Failed to load skill',
    errorKind: 'temporary_failure' as SkillPageErrorKind,
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
    setHeaders({
      'X-Skillscat-Status-Override': '404',
      'Cache-Control': 'no-store',
    });
    return finish(createNotFoundResult());
  }

  if (!normalizedName) {
    setHeaders({
      'X-Skillscat-Status-Override': '404',
      'Cache-Control': 'no-store',
    });
    return finish(createNotFoundResult());
  }

  if (normalizedOwner !== params.owner || normalizedName !== params.name) {
    throw redirect(308, buildSkillPathFromOwnerAndName(normalizedOwner, normalizedName));
  }

  const slug = buildSkillSlug(normalizedOwner, normalizedName);

  try {
    const skill = await timed(
      'skill_detail',
      () => getSkillBySlug(
        env,
        slug,
        userId,
        (name, dur, desc) => {
          serverTimings.push({ name, dur, desc });
        },
        Boolean(isDataRequest)
      ),
      'db+r2'
    );

    if (!skill) {
      setHeaders({
        'X-Skillscat-Status-Override': '404',
        'Cache-Control': 'no-store',
      });
      return finish(createNotFoundResult());
    }

    const shouldDeferUserState = skill.visibility === 'public';
    setPublicPageCache({
      setHeaders,
      request,
      isAuthenticated: shouldDeferUserState ? false : Boolean(locals.user),
      sMaxAge: 120,
      staleWhileRevalidate: 600,
      varyByLanguageHeader: false,
      varyByCookie: !shouldDeferUserState,
    });

    if (shouldDeferUserState) {
      setHeaders({ [PUBLIC_SKILL_HTML_CACHE_HEADER]: '1' });
    }

    const deferRecommendSkills = Boolean(isDataRequest);
    const recommendSkillsPromise = deferRecommendSkills
      ? Promise.resolve<SkillCardData[]>([])
      : timed(
        'recommend',
        async () => {
          if (skill.visibility === 'public') {
            const encodedSlug = encodeSkillSlugForPath(skill.slug);
            if (encodedSlug) {
              try {
                const response = await fetch(`/api/skills/${encodedSlug}/recommend`, {
                  headers: { accept: 'application/json' }
                });
                if (response.ok) {
                  const payload = await response.json() as {
                    success?: boolean;
                    data?: { recommendSkills?: SkillCardData[] };
                  };
                  if (payload.success) {
                    return payload.data?.recommendSkills || [];
                  }
                }
              } catch (recommendApiError) {
                console.warn('SSR recommend API fetch failed, fallback to DB query:', recommendApiError);
              }
            }
          }

          const { data } = await getCached(
            `recommend:${skill.id}`,
            () => getRecommendedSkills(
              env,
              skill.id,
              skill.categories || [],
              skill.repoOwner || '',
              10,
              (name, dur, desc) => {
                serverTimings.push({ name, dur, desc });
              },
              false
            ),
            RECOMMEND_SKILLS_CACHE_TTL
          );
          return data;
        },
        'secondary'
      );

    if (deferRecommendSkills) {
      serverTimings.push({ name: 'recommend', dur: 0, desc: 'deferred' });
    }

    const renderedReadmePromise = timed(
      'readme_html',
      async (): Promise<string> => {
        if (skill.visibility !== 'public') {
          const rawReadme = skill.readme ?? await loadSkillReadmeFromR2(env, skill);
          return rawReadme ? renderReadmeMarkdown(rawReadme) : '';
        }

        const readmeVersion = skill.updatedAt ?? skill.indexedAt ?? 0;
        const { data } = await getCached(
          `readme:html:${skill.id}:${readmeVersion}`,
          async () => {
            const rawReadme = skill.readme ?? await loadSkillReadmeFromR2(env, skill);
            return rawReadme ? renderReadmeMarkdown(rawReadme) : '';
          },
          README_HTML_CACHE_TTL
        );
        return data;
      },
      'secondary'
    );

    const isBookmarkedPromise = shouldDeferUserState
      ? Promise.resolve(false)
      : timed(
        'bookmark',
        async () => {
          if (!userId || !env.DB) return false;
          const bookmark = await env.DB.prepare(
            'SELECT 1 FROM favorites WHERE user_id = ? AND skill_id = ?'
          ).bind(userId, skill.id).first();
          return !!bookmark;
        },
        'secondary'
      );

    const [recommendSkillsResult, renderedReadmeResult, isBookmarkedResult] = await Promise.allSettled([
      recommendSkillsPromise,
      renderedReadmePromise,
      isBookmarkedPromise,
    ]);

    const recommendSkills = recommendSkillsResult.status === 'fulfilled'
      ? recommendSkillsResult.value
      : (console.error('Failed to load recommend skills:', recommendSkillsResult.reason), []);

    const renderedReadme = renderedReadmeResult.status === 'fulfilled'
      ? renderedReadmeResult.value
      : (console.error('Failed to render/read cached SKILL.md HTML:', renderedReadmeResult.reason), '');

    const isBookmarked = isBookmarkedResult.status === 'fulfilled'
      ? isBookmarkedResult.value
      : (console.error('Failed to load bookmark state:', isBookmarkedResult.reason), false);

    // Determine if this is a dot-folder skill (e.g., .claude/SKILL.md)
    const isDotFolderSkill = skill.skillPath ? /^\.[\w-]+/.test(skill.skillPath) : false;
    const hasReadme = Boolean(skill.readme) || Boolean(renderedReadme);
    // Avoid sending both raw markdown and rendered HTML in the same data payload.
    const skillForClient: SkillDetail = hasReadme ? { ...skill, readme: null } : skill;
    const install = buildSkillInstallData(skillForClient);
    const seo = buildSkillSeoPayload(skill);

    return finish({
      skill: skillForClient,
      install,
      renderedReadme,
      recommendSkills,
      deferRecommendSkills,
      isBookmarked: shouldDeferUserState ? false : isBookmarked,
      isAuthenticated: shouldDeferUserState ? false : !!userId,
      deferUserState: shouldDeferUserState,
      trackPublicAccessClientSide: shouldDeferUserState,
      isDotFolderSkill,
      hasReadme,
      seo,
    });
  } catch (error) {
    console.error('Error loading skill:', error);
    setHeaders({
      'X-Skillscat-Status-Override': '500',
      'Cache-Control': 'no-store',
    });
    return finish(createTemporaryFailureResult());
  }
};
