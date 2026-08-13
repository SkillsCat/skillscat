/**
 * Classification Worker
 *
 * Cost-optimized skill classification:
 * - AI classification only for hot-worthy skills
 * - Keyword-based for all other repos (never skip)
 * - Supports reclassification when skills become hot-worthy
 *
 * Expected to keep AI spend focused on the most valuable skills
 */

import type {
  ClassificationEnv,
  ClassificationMessage,
  ClassificationResult,
  OpenRouterResponse,
  ClassificationMethod,
  SkillTier,
} from './shared/types';
import { TIER_CONFIG } from './shared/types';
import {
  CATEGORIES,
  canonicalizeCategorySlug,
  canonicalizeCategorySlugs,
  getCategorySlugs,
} from './shared/classification/categories';
import {
  DEFAULT_OPENROUTER_PAID_MODEL,
  getDefaultOpenRouterFreeModel,
  getOpenRouterJsonGenerationOptions,
  getOpenRouterFreePauseUntil,
  getOpenRouterFreePauseStore,
  isOpenRouterFreeModel,
  isOpenRouterFreePauseError,
  normalizeOpenRouterModelId,
  OpenRouterApiError,
  parseOpenRouterRetryAfterMs,
  pauseOpenRouterFreeModels,
  resolveOpenRouterFreeModelCandidates,
} from './shared/ai/openrouter';
import { createLogger } from './shared/utils';
import { buildGithubSkillR2Keys, buildUploadSkillR2Key } from '../src/lib/skill-path';
import { invalidateCache } from '../src/lib/server/cache';
import { invalidateCategoryCaches } from '../src/lib/server/cache/categories';
import {
  getSkillPageCacheInvalidationKeys,
  getSkillSourceCacheKey,
} from '../src/lib/server/cache/keys';
import { syncCategoryPublicStats } from '../src/lib/server/db/business/stats';
import { markRecommendDirty } from '../src/lib/server/ranking/recommend-precompute';
import { markSearchDirty } from '../src/lib/server/ranking/search-precompute';
import { getSkillDetailCacheKeys } from '../src/lib/server/skill/detail';
import {
  buildIndexNowCategoryUrls,
  scheduleIndexNowSubmission,
} from '../src/lib/server/seo/indexnow';

const log = createLogger('Classification');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KEYWORD_SCORE_CAP_PER_KEYWORD = 3;
const KEYWORD_SLUG_TAG_MATCH_BOOST = 6;
const KEYWORD_TAG_MATCH_BOOST = 4;
const KEYWORD_MIN_SECONDARY_SCORE = 3;
const KEYWORD_SECONDARY_SCORE_RATIO = 0.5;
const KEYWORD_MIN_TERTIARY_SCORE = 5;
const KEYWORD_TERTIARY_SCORE_RATIO = 0.85;
const DESIGN_DIRECTION_SIGNAL_BOOST = 3;
const DESIGN_STRONG_SIGNAL_THRESHOLD = 2;
const DESIGN_DIRECTION_BONUS = 4;
const SPARSE_SIGNAL_BOOST = 2;
const SPARSE_SIGNAL_THRESHOLD = 2;
const SUMMARY_SKILL_MD_EXCERPT_CHARS = 2000;
const SUMMARY_MAX_OUTPUT_TOKENS = 220;
const SUMMARY_MAX_STORED_CHARS = 600;
const SUMMARY_MIN_OUTPUT_CHARS = 24;
const SUMMARY_BACKFILL_CURSOR_KV_KEY = 'summary-backfill:cursor';
const SUMMARY_BACKFILL_DEFAULT_BATCH_SIZE = 40;
const SUMMARY_BACKFILL_MAX_BATCH_SIZE = 200;

const DESIGN_DIRECTION_SIGNALS = [
  'ui/ux',
  'ui design',
  'ux design',
  'user experience',
  'product design',
  'visual design',
  'figma',
  'wireframe',
  'prototype',
  'mockup',
  'mock-up',
  'typography',
  'palette',
  'brand',
  'branding',
  'brand identity',
  'style guide',
  'visual hierarchy',
  'visual polish',
  'design system',
  'design token',
  'design tokens',
  'user flow',
  'art direction',
  'design critique',
  'design review',
  'interface critique',
];

const UI_IMPLEMENTATION_SIGNALS = [
  'component',
  'component library',
  'html',
  'css',
  'tailwind',
  'shadcn',
  'react',
  'vue',
  'svelte',
  'jsx',
  'tsx',
];

async function invalidateSkillCaches(
  skillId: string,
  env: ClassificationEnv,
  knownSlug?: string | null
): Promise<void> {
  let slug = knownSlug || null;
  if (!slug) {
    try {
      slug = (await env.DB.prepare('SELECT slug FROM skills WHERE id = ? LIMIT 1')
        .bind(skillId)
        .first<{ slug: string }>())?.slug || null;
    } catch {
      return;
    }
  }

  if (!slug) {
    return;
  }

  const cacheKeys = new Set<string>([
    ...getSkillDetailCacheKeys(slug),
    `api:skill-files:${slug}`,
    `skill:${skillId}`,
    getSkillSourceCacheKey(slug),
    ...getSkillPageCacheInvalidationKeys(slug),
  ]);

  await Promise.all([...cacheKeys].map((cacheKey) => invalidateCache(cacheKey)));
}

const SPARSE_CATEGORY_SIGNAL_TERMS: Partial<Record<(typeof CATEGORIES)[number]['slug'], string[]>> = {
  accessibility: ['a11y', 'accessibility', 'aria', 'wcag', 'keyboard navigation', 'screen reader'],
  comments: ['comment', 'comments', 'annotation', 'annotate', 'docstring', 'inline comment', 'code comment'],
  finance: ['finance', 'financial', 'accounting', 'bookkeeping', 'budget', 'valuation', 'forecast'],
  'game-dev': ['game development', 'gamedev', 'unity', 'unreal', 'godot', 'gameplay', 'shader'],
  i18n: ['i18n', 'l10n', 'localization', 'translation', 'multilingual'],
  research: [
    'information gathering',
    'information synthesis',
    'source gathering',
    'source collection',
    'web research',
    'enterprise search',
    'market research',
    'market intelligence',
    'competitive intelligence',
    'sales intelligence',
    'account research',
    'company research',
    'competitor research',
    'user research',
    'source management',
    'source attribution',
    'news digest',
    'news monitoring',
  ],
  responsive: ['responsive', 'responsive design', 'mobile-first', 'breakpoint', 'media query', 'viewport', 'tablet'],
  templates: ['template', 'templates', 'starter kit', 'blueprint', 'skeleton'],
  'web3-crypto': ['web3', 'crypto', 'blockchain', 'solidity', 'smart contract', 'onchain', 'wallet'],
};

// Extended classification result with optional suggested category
interface ExtendedClassificationResult extends ClassificationResult {
  suggestedCategory?: {
    slug: string;
    name: string;
    description: string;
  };
}

// Extended message type with metadata for admission decision
interface ClassificationMessageWithMeta extends ClassificationMessage {
  stars?: number;
  tier?: SkillTier | null;
  topics?: string[];
  description?: string;
  tags?: string[]; // Tags from SKILL.md frontmatter for classification hints
  frontmatterCategories?: string[]; // Direct categories from frontmatter
  isReclassification?: boolean; // Flag for reclassification when a skill becomes AI-eligible
}

interface ClassificationSkillStorageLocation {
  slug: string;
  source_type: string;
  repo_owner: string | null;
  repo_name: string | null;
  skill_path: string | null;
  readme: string | null;
  tier?: SkillTier | null;
}

interface ClassificationSkillStorageRow extends ClassificationSkillStorageLocation {
  id: string;
}

interface ClassificationBatchMetricStats {
  total: number;
  succeeded: number;
  retried: number;
  skipped: number;
  direct: number;
  ai: number;
  keyword: number;
}

async function loadClassificationSkillStorageLocations(
  env: Pick<ClassificationEnv, 'DB'>,
  skillIds: string[]
): Promise<Map<string, ClassificationSkillStorageLocation>> {
  if (skillIds.length === 0) {
    return new Map();
  }

  const placeholders = skillIds.map(() => '?').join(',');
  const result = await env.DB.prepare(`
    SELECT id, slug, source_type, repo_owner, repo_name, skill_path, readme, tier
    FROM skills
    WHERE id IN (${placeholders})
  `)
    .bind(...skillIds)
    .all<ClassificationSkillStorageRow>();

  return new Map(
    (result.results || []).map((row) => [
      row.id,
      {
        slug: row.slug,
        source_type: row.source_type,
        repo_owner: row.repo_owner,
        repo_name: row.repo_name,
        skill_path: row.skill_path,
        readme: row.readme,
        tier: row.tier,
      } satisfies ClassificationSkillStorageLocation,
    ])
  );
}

function needsClassificationSkillStoragePreload(message: ClassificationMessageWithMeta): boolean {
  if (!message.skillId) {
    return false;
  }

  if (message.isReclassification) {
    return true;
  }

  return tryDirectCategoryMatch(message.frontmatterCategories) === null;
}

export async function loadSkillMdForClassification(
  env: Pick<ClassificationEnv, 'DB' | 'R2'>,
  skillId: string,
  skillMdPath: string,
  preloadedSkill: ClassificationSkillStorageLocation | null | undefined = undefined
): Promise<string | null> {
  const directObject = await env.R2.get(skillMdPath);
  if (directObject) {
    return directObject.text();
  }

  const skill = preloadedSkill !== undefined
    ? preloadedSkill
    : await env.DB.prepare(`
      SELECT slug, source_type, repo_owner, repo_name, skill_path, readme, tier
      FROM skills
      WHERE id = ?
      LIMIT 1
    `)
      .bind(skillId)
      .first<ClassificationSkillStorageLocation>();

  if (!skill) {
    return null;
  }

  const candidateKeys = skill.source_type === 'upload'
    ? [buildUploadSkillR2Key(skill.slug, 'SKILL.md')].filter(Boolean)
    : (
      skill.repo_owner && skill.repo_name
        ? buildGithubSkillR2Keys(skill.repo_owner, skill.repo_name, skill.skill_path, 'SKILL.md')
        : []
    );

  for (const candidateKey of candidateKeys) {
    const object = await env.R2.get(candidateKey);
    if (object) {
      return object.text();
    }
  }

  return skill.readme;
}

/**
 * Restrict AI classification to hot-worthy skills so we keep spend focused.
 * We prefer the stored tier when available, and fall back to the hot star threshold
 * for newly indexed skills that have not been tiered yet.
 */
export function determineClassificationMethod(
  stars: number,
  tier?: SkillTier | null
): ClassificationMethod {
  if (tier === 'hot' || stars >= TIER_CONFIG.hot.minStars) {
    return 'ai';
  }

  // All other repos get keyword classification (never skip)
  return 'keyword';
}

function normalizeSkillTier(tier: string | null | undefined): SkillTier | null {
  if (tier === 'hot' || tier === 'warm' || tier === 'cool' || tier === 'cold' || tier === 'archived') {
    return tier;
  }

  return null;
}

/**
 * Try to match frontmatter categories directly to valid category slugs
 * This is the cheapest classification method - no AI or keyword matching needed
 * Returns null if no valid categories found, triggering fallback to AI/keyword
 */
function tryDirectCategoryMatch(
  frontmatterCategories: string[] | undefined
): ClassificationResult | null {
  if (!frontmatterCategories || frontmatterCategories.length === 0) {
    return null;
  }

  const validCategories = canonicalizeCategorySlugs(frontmatterCategories).slice(0, 3);

  if (validCategories.length === 0) {
    return null; // No valid categories, fall back to AI/keyword
  }

  return {
    categories: validCategories,
    confidence: 1.0, // Author-specified categories have highest confidence
    reasoning: 'Directly matched from SKILL.md frontmatter',
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countKeywordMatches(contentLower: string, keyword: string): number {
  const escapedKeyword = escapeRegExp(keyword.toLowerCase());
  const pattern = new RegExp(`(^|[^a-z0-9])${escapedKeyword}(?=$|[^a-z0-9])`, 'g');
  return [...contentLower.matchAll(pattern)].length;
}

function countSignalMatches(
  contentLower: string,
  keywords: string[],
  normalizedTags: string[]
): number {
  let score = 0;

  for (const keyword of keywords) {
    const matches = countKeywordMatches(contentLower, keyword);
    if (matches > 0) {
      score += Math.min(matches, KEYWORD_SCORE_CAP_PER_KEYWORD);
    }

    if (normalizedTags.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }

  return score;
}

function buildClassificationPrompt(skillMdContent: string, tags?: string[]): string {
  const categoriesDescription = CATEGORIES.map(
    (c) => `- ${c.slug}: ${c.name} - ${c.description} (keywords: ${c.keywords.join(', ')})`
  ).join('\n');

  let tagsHint = '';
  if (tags && tags.length > 0) {
    tagsHint = `\n\nAuthor-provided tags (use as hints for classification): ${tags.join(', ')}\n`;
  }

  return `You are a skill classifier for AI agent skills. Analyze the following SKILL.md content and classify it into 1-3 most relevant categories.

IMPORTANT RULES:
1. You MUST always provide at least 1 category - never return an empty categories array
2. Prefer the category that best describes the skill's main job for the user, not just the tooling or framework it mentions
3. Prefer specific task categories over broad buckets like automation, cli, templates, writing, or agents when a more precise category fits
4. Only include a secondary or tertiary category when the skill clearly has another major capability, not just a minor implementation detail
5. Use design for UI/UX direction, visual critiques, layout, typography, color, branding, wireframes, prototypes, Figma, or design-system planning
6. Use ui-components for implementation-focused component generation, styling, or framework-specific frontend code
7. Use embeddings only for real vector retrieval, similarity search, reranking, vector databases, or RAG workflows; never for visual semantics, semantic HTML, or UX search flows
8. Do NOT suggest a new category when an existing canonical category already fits. For example: brand-design, creative-design, design-systems, design-to-code, visual-design, frontend-design, and ui-ux should all map to design; data-visualization should map to analytics; financial-analysis/modeling/reporting/accounting should map to finance; market-research, market-intelligence, sales-intelligence, account-research, competitive-intelligence, information-synthesis, enterprise-search, and source-management should map to research, while academic should stay focused on scholarly writing, citations, and literature work
9. If the skill still doesn't fit well into existing categories after applying those canonical mappings, you may suggest ONE new secondary category
10. Suggested categories should be specific and useful for developers (not too broad or too niche)

Available categories:
${categoriesDescription}
${tagsHint}
SKILL.md content:
---
${skillMdContent.slice(0, 4000)}
---

Respond with a JSON object containing:
- categories: array of category slugs (1-3 items, most relevant first) - REQUIRED, must have at least 1
- confidence: number between 0 and 1
- reasoning: brief explanation of why these categories were chosen
- suggestedCategory: (OPTIONAL) if no existing category fits well as a secondary category, suggest ONE new category with:
  - slug: kebab-case slug (e.g., "data-visualization", "code-migration")
  - name: short display name (e.g., "Data Viz", "Migration")
  - description: brief description of what this category covers

Example response with existing categories only:
{"categories": ["git", "automation"], "confidence": 0.85, "reasoning": "This skill automates git commit message generation"}

Example response with suggested category:
{"categories": ["data-processing"], "confidence": 0.7, "reasoning": "This skill processes scientific data", "suggestedCategory": {"slug": "scientific-computing", "name": "Scientific", "description": "Scientific computing and research tools"}}

Respond ONLY with the JSON object, no other text.`;
}

/**
 * Build the prompt for the per-skill functional summary.
 * Input is capped to keep token spend flat regardless of SKILL.md size.
 */
export function buildSkillSummaryPrompt(skillMdContent: string, description?: string | null): string {
  const trimmedDescription = (description || '').trim();

  return `You are summarizing an AI agent skill for a public software directory.
${trimmedDescription ? `\nAuthor-provided short description: ${trimmedDescription.slice(0, 300)}\n` : ''}
SKILL.md excerpt:
---
${skillMdContent.slice(0, SUMMARY_SKILL_MD_EXCERPT_CHARS)}
---

Write a 2-3 sentence plain-text summary in English that objectively explains:
- what this skill does
- what problem it solves
- when an agent or developer should use it

Rules:
- Objective, factual tone only: no marketing language, no superlatives, no calls to action
- Natural prose, no keyword stuffing, no bullet points, no headings, no markdown formatting
- Do not wrap the answer in quotes
- At most 60 words

Respond with ONLY the summary text.`;
}

/**
 * Normalize raw model output into a storable one-line summary.
 * Returns null when the output is unusable.
 */
export function sanitizeSkillSummary(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  let text = raw.replace(/\s+/g, ' ').trim();
  // Strip wrapping quotes some models add despite the prompt.
  text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  if (text.length < SUMMARY_MIN_OUTPUT_CHARS) {
    return null;
  }

  if (text.length > SUMMARY_MAX_STORED_CHARS) {
    const cut = text.slice(0, SUMMARY_MAX_STORED_CHARS);
    const lastSentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = lastSentenceEnd > SUMMARY_MIN_OUTPUT_CHARS ? cut.slice(0, lastSentenceEnd + 1) : cut;
  }

  return text;
}

/**
 * Plain-text variant of callOpenRouter for summary generation.
 * Shares the same endpoint, headers, and error semantics, but skips the JSON
 * response format so models answer in prose.
 */
async function callOpenRouterText(
  prompt: string,
  model: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://skills.cat',
      'X-Title': 'SkillsCat Classification Worker',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new OpenRouterApiError({
      model,
      status: response.status,
      retryAfterMs: parseOpenRouterRetryAfterMs(response.headers),
      message: `OpenRouter API error: ${response.status} - ${error}`,
    });
  }

  const data = await response.json() as unknown as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenRouter response');
  }

  return content;
}

/**
 * Generate the functional summary with the same cost policy as classification:
 * configured free candidates first (respecting the shared pause store), then the
 * configured paid model. Returns null when no provider succeeds.
 */
export async function generateSkillSummary(
  skillMdContent: string,
  description: string | null,
  env: ClassificationEnv
): Promise<string | null> {
  if (!env.OPENROUTER_API_KEY) {
    return null;
  }

  const prompt = buildSkillSummaryPrompt(skillMdContent, description);
  const freeModels = getFreeModelCandidates(env);
  const openRouterPauseStore = getOpenRouterFreePauseStore(env);
  const freePausedUntil = await getOpenRouterFreePauseUntil(openRouterPauseStore, Date.now());

  if (freeModels.length > 0 && !freePausedUntil) {
    for (const model of freeModels) {
      try {
        const summary = sanitizeSkillSummary(await callOpenRouterText(prompt, model, env.OPENROUTER_API_KEY));
        if (summary) {
          return summary;
        }
      } catch (error) {
        console.error(`[OpenRouter] Free summary model failed (${model}):`, error);
        if (isOpenRouterFreePauseError(error)) {
          await pauseOpenRouterFreeModels(openRouterPauseStore, {
            retryAfterMs: error.retryAfterMs,
          });
          break;
        }
      }
    }
  }

  try {
    const paidModel = getClassificationPaidModel(env);
    return sanitizeSkillSummary(await callOpenRouterText(prompt, paidModel, env.OPENROUTER_API_KEY));
  } catch (error) {
    console.error('[OpenRouter] Paid summary model failed:', error);
    return null;
  }
}

interface EnsureSkillSummaryParams {
  skillId: string;
  skillSlug?: string | null;
  skillMdPath?: string;
  skillMdContent?: string | null;
  preloadedSkill?: ClassificationSkillStorageLocation | null;
}

/**
 * Best-effort summary backfill inside the classification flow.
 * Skips skills that already have a summary, never throws, and never blocks
 * classification: any failure just leaves summary NULL for a later pass.
 */
export async function ensureSkillSummary(
  env: ClassificationEnv,
  params: EnsureSkillSummaryParams
): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT summary, description FROM skills WHERE id = ? LIMIT 1')
      .bind(params.skillId)
      .first<{ summary: string | null; description: string | null }>();

    if (!row || (row.summary && row.summary.trim().length > 0)) {
      return null;
    }

    if (!env.OPENROUTER_API_KEY) {
      return null;
    }

    const skillMdContent = params.skillMdContent
      ?? (params.skillMdPath
        ? await loadSkillMdForClassification(env, params.skillId, params.skillMdPath, params.preloadedSkill)
        : null);

    if (!skillMdContent) {
      return null;
    }

    const summary = await generateSkillSummary(skillMdContent, row.description, env);
    if (!summary) {
      return null;
    }

    // Deliberately do not bump updated_at: the summary is derived metadata and
    // must not masquerade as a skill content update. Caches are invalidated
    // explicitly below instead.
    await env.DB.prepare(`
      UPDATE skills SET summary = ? WHERE id = ? AND (summary IS NULL OR summary = '')
    `)
      .bind(summary, params.skillId)
      .run();

    log.log(`Generated summary for skill: ${params.skillId} (${summary.length} chars)`);

    try {
      await invalidateSkillCaches(params.skillId, env, params.skillSlug);
    } catch (cacheError) {
      log.error(`Failed to invalidate skill caches after summary update for ${params.skillId}:`, cacheError);
    }

    return summary;
  } catch (error) {
    log.error(`Failed to ensure summary for ${params.skillId}:`, error);
    return null;
  }
}

export function normalizeSummaryBackfillBatchSize(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SUMMARY_BACKFILL_DEFAULT_BATCH_SIZE;
  }
  return Math.min(parsed, SUMMARY_BACKFILL_MAX_BATCH_SIZE);
}

interface SummaryBackfillCandidateRow extends ClassificationSkillStorageLocation {
  rowid: number;
  id: string;
}

/**
 * Primary R2 key for the candidate's SKILL.md. Always truthy: a wrong key is
 * fine because `loadSkillMdForClassification` only consults the
 * location-derived candidate keys and the D1 readme fallback after the direct
 * key misses — but it never runs at all when given a falsy path.
 */
function buildSummaryBackfillSkillMdPath(skill: ClassificationSkillStorageLocation): string {
  if (skill.source_type === 'upload') {
    return buildUploadSkillR2Key(skill.slug, 'SKILL.md') || 'SKILL.md';
  }
  if (skill.repo_owner && skill.repo_name) {
    return buildGithubSkillR2Keys(skill.repo_owner, skill.repo_name, skill.skill_path, 'SKILL.md')[0] ?? 'SKILL.md';
  }
  return 'SKILL.md';
}

/**
 * Candidates mirror the SEO indexability gate (public, not archived, any real
 * content): those are the detail pages Google crawls, so they are exactly the
 * pages whose unique-text thickness the summary improves.
 */
async function loadSummaryBackfillCandidates(
  env: Pick<ClassificationEnv, 'DB'>,
  cursor: number,
  batchSize: number
): Promise<SummaryBackfillCandidateRow[]> {
  const result = await env.DB.prepare(`
    SELECT rowid, id, slug, source_type, repo_owner, repo_name, skill_path, readme, tier
    FROM skills
    WHERE rowid > ?
      AND (summary IS NULL OR TRIM(summary) = '')
      AND visibility = 'public'
      AND COALESCE(tier, 'cold') <> 'archived'
      AND (
        TRIM(COALESCE(description, '')) <> ''
        OR TRIM(COALESCE(readme, '')) <> ''
      )
    ORDER BY rowid
    LIMIT ?
  `)
    .bind(cursor, batchSize)
    .all<SummaryBackfillCandidateRow>();

  return result.results || [];
}

export interface SummaryBackfillRunStats {
  processed: number;
  generated: number;
  cursor: number;
}

/**
 * Cron-driven backfill for the stock of skills that never got an AI summary
 * (classified before summaries existed, or generation failed transiently and
 * was never retried). Walks the skills table with a KV-stored rowid cursor in
 * small batches; rows that fail simply get revisited on the next wrap-around.
 */
export async function runSummaryBackfill(env: ClassificationEnv): Promise<SummaryBackfillRunStats> {
  const batchSize = normalizeSummaryBackfillBatchSize(env.SUMMARY_BACKFILL_BATCH_SIZE);
  const storedCursor = Number.parseInt((await env.KV.get(SUMMARY_BACKFILL_CURSOR_KV_KEY)) ?? '', 10);
  let cursor = Number.isFinite(storedCursor) && storedCursor > 0 ? storedCursor : 0;

  let candidates = await loadSummaryBackfillCandidates(env, cursor, batchSize);
  const hadCursor = cursor > 0;
  if (candidates.length === 0 && hadCursor) {
    // Reached the end of the table; wrap around for the next cycle.
    cursor = 0;
    candidates = await loadSummaryBackfillCandidates(env, cursor, batchSize);
  }

  if (candidates.length === 0) {
    if (hadCursor) {
      await env.KV.put(SUMMARY_BACKFILL_CURSOR_KV_KEY, '0');
    }
    return { processed: 0, generated: 0, cursor: 0 };
  }

  let generated = 0;
  let maxRowid = cursor;

  for (const candidate of candidates) {
    maxRowid = Math.max(maxRowid, candidate.rowid);
    const summary = await ensureSkillSummary(env, {
      skillId: candidate.id,
      skillSlug: candidate.slug,
      skillMdPath: buildSummaryBackfillSkillMdPath(candidate),
      preloadedSkill: {
        slug: candidate.slug,
        source_type: candidate.source_type,
        repo_owner: candidate.repo_owner,
        repo_name: candidate.repo_name,
        skill_path: candidate.skill_path,
        readme: candidate.readme,
        tier: candidate.tier,
      },
    });
    if (summary) {
      generated += 1;
    }
  }

  await env.KV.put(SUMMARY_BACKFILL_CURSOR_KV_KEY, String(maxRowid));
  return { processed: candidates.length, generated, cursor: maxRowid };
}

async function callOpenRouter(
  prompt: string,
  model: string,
  apiKey: string
): Promise<ClassificationResult> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://skills.cat',
      'X-Title': 'SkillsCat Classification Worker',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      ...getOpenRouterJsonGenerationOptions(model, 'classification'),
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new OpenRouterApiError({
      model,
      status: response.status,
      retryAfterMs: parseOpenRouterRetryAfterMs(response.headers),
      message: `OpenRouter API error: ${response.status} - ${error}`,
    });
  }

  const data = await response.json() as Record<string, unknown>;

  // Log full response for debugging if structure is unexpected
  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    console.error(`[OpenRouter] Unexpected response structure:`, JSON.stringify(data));
    throw new Error(`OpenRouter returned unexpected response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const typedData = data as unknown as OpenRouterResponse;
  const content = typedData.choices[0]?.message?.content;

  if (!content) {
    console.error(`[OpenRouter] No content in response:`, JSON.stringify(data));
    throw new Error('No content in OpenRouter response');
  }

  return parseClassificationResult(content);
}

function parseClassificationResult(content: string): ExtendedClassificationResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const result = JSON.parse(jsonMatch[0]);
  const validSlugs = new Set(getCategorySlugs());
  const categories = canonicalizeCategorySlugs(result.categories || []).slice(0, 3);

  // Ensure at least one category
  if (categories.length === 0) {
    categories.push('productivity');
  }

  // Parse suggested category if present
  let suggestedCategory: ExtendedClassificationResult['suggestedCategory'] | undefined;
  if (result.suggestedCategory && typeof result.suggestedCategory === 'object') {
    const suggested = result.suggestedCategory;
    // Validate suggested category format
    if (
      typeof suggested.slug === 'string' &&
      typeof suggested.name === 'string' &&
      typeof suggested.description === 'string' &&
      // Validate slug format (kebab-case)
      /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(suggested.slug) &&
      // Ensure it doesn't conflict with existing categories
      !validSlugs.has(suggested.slug) &&
      // Reasonable length limits
      suggested.slug.length <= 50 &&
      suggested.name.length <= 30 &&
      suggested.description.length <= 200
    ) {
      const canonicalSuggestedSlug = canonicalizeCategorySlug(suggested.slug);

      if (canonicalSuggestedSlug) {
        if (!categories.includes(canonicalSuggestedSlug)) {
          if (categories.length === 0) {
            categories.push(canonicalSuggestedSlug);
          } else {
            categories.splice(1, 0, canonicalSuggestedSlug);
            categories.splice(3);
          }
        }
      } else {
        suggestedCategory = {
          slug: suggested.slug,
          name: suggested.name,
          description: suggested.description
        };
      }
    }
  }

  return {
    categories,
    confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
    reasoning: result.reasoning,
    suggestedCategory
  };
}

/**
 * Get ordered free model candidates for classification.
 * Explicit configuration defines the pool and its order. Defaults are used only when
 * no valid configured candidate is present.
 */
export function getFreeModelCandidates(env: ClassificationEnv): string[] {
  return resolveOpenRouterFreeModelCandidates(env.AI_MODEL, env.FREE_MODELS);
}

function getClassificationPaidModel(env: ClassificationEnv): string {
  const configured = normalizeOpenRouterModelId(
    env.CLASSIFICATION_PAID_MODEL?.trim() || DEFAULT_OPENROUTER_PAID_MODEL
  );
  return isOpenRouterFreeModel(configured) ? DEFAULT_OPENROUTER_PAID_MODEL : configured;
}

export function classifyByKeywords(content: string, tags?: string[]): ClassificationResult {
  const contentLower = content.toLowerCase();
  const normalizedTags = (tags || []).map((tag) => tag.toLowerCase().trim()).filter(Boolean);
  const canonicalTagSlugs = new Set(
    normalizedTags
      .map((tag) => canonicalizeCategorySlug(tag))
      .filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
  );
  const scores: Record<string, number> = {};

  for (const category of CATEGORIES) {
    let score = 0;
    for (const keyword of category.keywords) {
      const matches = countKeywordMatches(contentLower, keyword);
      if (matches > 0) {
        score += Math.min(matches, KEYWORD_SCORE_CAP_PER_KEYWORD);
      }

      // Boost score if tag matches category keyword
      if (normalizedTags.includes(keyword.toLowerCase())) {
        score += KEYWORD_TAG_MATCH_BOOST;
      }
    }

    // Also check if any tag directly matches the category slug
    if (canonicalTagSlugs.has(category.slug)) {
      score += KEYWORD_SLUG_TAG_MATCH_BOOST;
    }

    if (score > 0) {
      scores[category.slug] = score;
    }
  }

  const designDirectionScore = countSignalMatches(contentLower, DESIGN_DIRECTION_SIGNALS, normalizedTags);
  const uiImplementationScore = countSignalMatches(contentLower, UI_IMPLEMENTATION_SIGNALS, normalizedTags);

  if (designDirectionScore > 0) {
    scores.design = (scores.design || 0) + (designDirectionScore * DESIGN_DIRECTION_SIGNAL_BOOST);

    if (
      designDirectionScore >= DESIGN_STRONG_SIGNAL_THRESHOLD &&
      uiImplementationScore <= designDirectionScore
    ) {
      scores.design += DESIGN_DIRECTION_BONUS;
    }
  }

  for (const [slug, signalTerms] of Object.entries(SPARSE_CATEGORY_SIGNAL_TERMS)) {
    const signalScore = countSignalMatches(contentLower, signalTerms || [], normalizedTags);
    if (signalScore >= SPARSE_SIGNAL_THRESHOLD) {
      scores[slug] = (scores[slug] || 0) + (signalScore * SPARSE_SIGNAL_BOOST);
    }
  }

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (sorted.length === 0) {
    return {
      categories: ['productivity'],
      confidence: 0.3,
      reasoning: 'No keywords matched, defaulting to productivity',
    };
  }

  const [topSlug, topScore] = sorted[0];
  const selected: string[] = [topSlug];

  for (const [slug, score] of sorted.slice(1)) {
    if (selected.length >= 3) break;

    const shouldIncludeAsSecondary =
      selected.length === 1 &&
      score >= KEYWORD_MIN_SECONDARY_SCORE &&
      score / topScore >= KEYWORD_SECONDARY_SCORE_RATIO;
    const shouldIncludeAsTertiary =
      selected.length === 2 &&
      score >= KEYWORD_MIN_TERTIARY_SCORE &&
      score / topScore >= KEYWORD_TERTIARY_SCORE_RATIO;

    if (shouldIncludeAsSecondary || shouldIncludeAsTertiary) {
      selected.push(slug);
    }
  }

  return {
    categories: selected,
    confidence: Math.min(0.85, 0.4 + topScore * 0.05 + (selected.length - 1) * 0.05),
    reasoning: `Classified by weighted keyword matching${normalizedTags.length > 0 ? ' with tag boosts' : ''}`,
  };
}

/**
 * Classify skill using AI with multi-model fallback strategy:
 * 1. Try configured free candidates in order, retrying the first once
 * 2. Try the configured paid model
 * 3. Fall back to keyword classification
 */
export async function classifyWithAI(
  skillMdContent: string,
  env: ClassificationEnv,
  tags?: string[]
): Promise<ExtendedClassificationResult> {
  const prompt = buildClassificationPrompt(skillMdContent, tags);
  const freeModels = getFreeModelCandidates(env);
  const paidModel = getClassificationPaidModel(env);
  const now = Date.now();
  const openRouterPauseStore = getOpenRouterFreePauseStore(env);
  const freePausedUntil = await getOpenRouterFreePauseUntil(openRouterPauseStore, now);
  let freeRateLimited = false;

  // 1. Try OpenRouter free models first when available.
  if (env.OPENROUTER_API_KEY && freeModels.length > 0 && !freePausedUntil) {
    const freeAttempts = freeModels.flatMap((model, index) => (
      index === 0
        ? [{ model, retry: false }, { model, retry: true }]
        : [{ model, retry: false }]
    ));

    for (const attempt of freeAttempts) {
      try {
        console.log(
          attempt.retry
            ? `[OpenRouter] Retrying free classification model: ${attempt.model}`
            : `[OpenRouter] Trying free classification model: ${attempt.model}`
        );
        return await callOpenRouter(prompt, attempt.model, env.OPENROUTER_API_KEY);
      } catch (error) {
        console.error(
          attempt.retry
            ? `[OpenRouter] Free model retry failed:`
            : `[OpenRouter] Free model failed:`,
          error
        );
        if (isOpenRouterFreePauseError(error)) {
          await pauseOpenRouterFreeModels(openRouterPauseStore, {
            now,
            retryAfterMs: error.retryAfterMs,
          });
          freeRateLimited = true;
          break;
        }
      }
    }
  } else if (!env.OPENROUTER_API_KEY) {
    console.log('[OpenRouter] No API key configured');
  } else if (freeModels.length > 0 && freePausedUntil) {
    console.log(`[OpenRouter] Free classification models paused until ${new Date(freePausedUntil).toISOString()}`);
  }

  // 2. Use the configured paid model only after the ordered free pool is unavailable or exhausted.
  if (env.OPENROUTER_API_KEY) {
    try {
      console.log(`[OpenRouter] Trying paid classification model: ${paidModel}`);
      return await callOpenRouter(prompt, paidModel, env.OPENROUTER_API_KEY);
    } catch (error) {
      console.error('[OpenRouter] Paid classification model failed:', error);
    }
  }

  // 3. Final fallback to keyword classification
  if (freeRateLimited) {
    console.log('[Fallback] Free classification models are rate limited, using keyword classification');
  } else {
    console.log('[Fallback] All AI providers failed, using keyword classification');
  }
  return classifyByKeywords(skillMdContent, tags);
}

async function saveClassification(
  skillId: string,
  result: ExtendedClassificationResult,
  method: ClassificationMethod,
  env: ClassificationEnv,
  knownSlug?: string | null
): Promise<string[]> {
  const now = Date.now();
  const previousCategories = await env.DB.prepare('SELECT category_slug FROM skill_categories WHERE skill_id = ?')
    .bind(skillId)
    .all<{ category_slug: string }>();
  const previousCategorySlugs = (previousCategories.results || []).map((row) => row.category_slug);
  const assignedCategorySlugs = new Set<string>();

  await env.DB.prepare('DELETE FROM skill_categories WHERE skill_id = ?')
    .bind(skillId)
    .run();

  // If there's a suggested category, save it to the categories table first
  if (result.suggestedCategory) {
    const { slug, name, description } = result.suggestedCategory;
    const categoryId = `cat_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
      // Check if category already exists (might have been suggested by another skill)
      const existing = await env.DB.prepare('SELECT id FROM categories WHERE slug = ?')
        .bind(slug)
        .first<{ id: string }>();

      if (!existing) {
        // Insert new AI-suggested category
        await env.DB.prepare(`
          INSERT INTO categories (id, slug, name, description, type, suggested_by_skill_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'ai-suggested', ?, ?, ?)
        `)
          .bind(categoryId, slug, name, description, skillId, now, now)
          .run();

        log.log(`Created new AI-suggested category: ${slug} (${name})`);
      }

      // Add the suggested category to the skill's categories
      await env.DB.prepare(`
        INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
        VALUES (?, ?)
      `)
        .bind(skillId, slug)
        .run();
      assignedCategorySlugs.add(slug);
    } catch (error) {
      log.error(`Failed to save suggested category ${slug}:`, error);
      // Continue with predefined categories even if suggested category fails
    }
  }

  // Save predefined categories
  for (let i = 0; i < result.categories.length; i++) {
    const categorySlug = result.categories[i];

    await env.DB.prepare(`
      INSERT OR IGNORE INTO skill_categories (skill_id, category_slug)
      VALUES (?, ?)
    `)
      .bind(skillId, categorySlug)
      .run();
    assignedCategorySlugs.add(categorySlug);
  }

  // Update skill with classification method
  await env.DB.prepare('UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?')
    .bind(method, now, skillId)
    .run();

  const affectedCategorySlugs = new Set<string>([
    ...previousCategorySlugs,
    ...Array.from(assignedCategorySlugs),
  ]);

  try {
    await syncCategoryPublicStats(env.DB, affectedCategorySlugs, now);
  } catch (error) {
    log.error('Failed to sync category public stats:', error);
  }

  try {
    await invalidateCategoryCaches(affectedCategorySlugs);
  } catch (error) {
    log.error('Failed to invalidate category caches after classification:', error);
  }

  try {
    await invalidateSkillCaches(skillId, env, knownSlug);
  } catch (error) {
    log.error(`Failed to invalidate skill caches after classification for ${skillId}:`, error);
  }

  await markRecommendDirty(env.DB, skillId, now);
  await markSearchDirty(env.DB, skillId, now);
  return [...affectedCategorySlugs];
}

function writeClassificationBatchMetric(
  env: ClassificationEnv,
  stats: ClassificationBatchMetricStats,
  preloadStatus: 'skipped' | 'succeeded' | 'failed'
): void {
  if (!env.CLASSIFICATION_ANALYTICS) {
    return;
  }

  try {
    env.CLASSIFICATION_ANALYTICS.writeDataPoint({
      blobs: [
        preloadStatus,
        getFreeModelCandidates(env)[0] || getDefaultOpenRouterFreeModel(),
        getClassificationPaidModel(env),
      ],
      doubles: [
        stats.total,
        stats.succeeded,
        stats.retried,
        stats.skipped,
        stats.direct,
        stats.ai,
        stats.keyword,
      ],
      indexes: ['classification-batch'],
    });
  } catch (error) {
    log.error('Failed to write classification batch analytics datapoint:', error);
  }
}

async function processMessage(
  message: ClassificationMessageWithMeta,
  env: ClassificationEnv,
  preloadedSkill: ClassificationSkillStorageLocation | null | undefined = undefined
): Promise<{ method: ClassificationMethod; affectedCategorySlugs: string[] } | null> {
  const { skillId, skillSlug, repoOwner, repoName, skillMdPath, stars = 0, tags = [], frontmatterCategories, isReclassification } = message;
  const knownSlug = skillSlug || preloadedSkill?.slug || null;

  log.log(`Processing skill: ${skillId} (${repoOwner}/${repoName})${isReclassification ? ' [RECLASSIFICATION]' : ''}`, JSON.stringify(message));
  if (tags.length > 0) {
    log.log(`Tags from frontmatter: ${tags.join(', ')}`);
  }
  if (frontmatterCategories && frontmatterCategories.length > 0) {
    log.log(`Frontmatter categories: ${frontmatterCategories.join(', ')}`);
  }

  // For reclassification, skip direct match and force AI classification
  if (!isReclassification) {
    // Try direct category match first (cheapest - no AI or keyword matching needed)
    const directMatch = tryDirectCategoryMatch(frontmatterCategories);
    if (directMatch) {
      log.log(`Direct category match for ${skillId}: ${directMatch.categories.join(', ')}`);

      // Save classification and return early
      try {
        const affectedCategorySlugs = await saveClassification(skillId, directMatch, 'direct', env, knownSlug);
        log.log(`Successfully saved direct classification for skill: ${skillId}, categories: ${directMatch.categories.join(', ')}`);
        // Best-effort summary generation; never blocks the ack.
        await ensureSkillSummary(env, { skillId, skillSlug: knownSlug, skillMdPath });
        return { method: 'direct', affectedCategorySlugs };
      } catch (saveError) {
        log.error(`Failed to save direct classification for ${skillId}:`, saveError);
        throw saveError;
      }
    }
  }

  // Determine classification method based on hot-worthiness.
  const resolvedTier = normalizeSkillTier(message.tier) ?? normalizeSkillTier(preloadedSkill?.tier);
  const method = determineClassificationMethod(stars, resolvedTier);
  log.log(`Method for ${skillId}: ${method} (stars: ${stars}, tier: ${resolvedTier ?? 'unknown'}${isReclassification ? ', reclassification' : ''})`);

  // Get SKILL.md content
  log.log(`Fetching SKILL.md from R2: ${skillMdPath}`);
  const skillMdContent = await loadSkillMdForClassification(env, skillId, skillMdPath, preloadedSkill);
  if (!skillMdContent) {
    log.error(`SKILL.md not found in R2: ${skillMdPath}`);
    return null;
  }
  log.log(`SKILL.md content length: ${skillMdContent.length} chars`);

  let result: ExtendedClassificationResult;

  if (method === 'ai') {
    log.log(`Starting AI classification for ${skillId}`);
    result = await classifyWithAI(skillMdContent, env, tags);
  } else {
    log.log(`Starting keyword classification for ${skillId}`);
    result = classifyByKeywords(skillMdContent, tags);
  }

  log.log(
    `Result for ${skillId}:`,
    result.categories,
    `(confidence: ${result.confidence}, method: ${method}, reasoning: ${result.reasoning}${result.suggestedCategory ? `, suggested: ${result.suggestedCategory.slug}` : ''})`
  );

  try {
    const affectedCategorySlugs = await saveClassification(skillId, result, method, env, knownSlug);
    log.log(`Successfully saved classification for skill: ${skillId}, categories: ${result.categories.join(', ')}`);
    // Best-effort summary generation reusing the already-loaded SKILL.md; never blocks the ack.
    await ensureSkillSummary(env, { skillId, skillSlug: knownSlug, skillMdContent });
    return { method, affectedCategorySlugs };
  } catch (saveError) {
    log.error(`Failed to save classification for ${skillId}:`, saveError);
    throw saveError;
  }
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: ClassificationEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runSummaryBackfill(env)
        .then((stats) => {
          log.log(`Summary backfill run: processed=${stats.processed} generated=${stats.generated} cursor=${stats.cursor}`);
        })
        .catch((error) => {
          log.error('Summary backfill run failed:', error);
        })
    );
  },

  async queue(
    batch: MessageBatch<ClassificationMessageWithMeta>,
    env: ClassificationEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    log.log(`Processing batch of ${batch.messages.length} messages`);
    let preloadedSkillsById = new Map<string, ClassificationSkillStorageLocation>();
    let preloadStatus: 'skipped' | 'succeeded' | 'failed' = 'skipped';
    const skillIdsToPreload = Array.from(new Set(
      batch.messages
        .map((message) => message.body)
        .filter(needsClassificationSkillStoragePreload)
        .map((message) => message.skillId)
        .filter(Boolean)
    ));
    if (skillIdsToPreload.length > 0) {
      try {
        preloadedSkillsById = await loadClassificationSkillStorageLocations(env, skillIdsToPreload);
        preloadStatus = 'succeeded';
      } catch (error) {
        preloadStatus = 'failed';
        log.warn('Failed to preload classification skill storage locations, falling back to per-message lookups', error);
      }
    }

    const batchMetricStats: ClassificationBatchMetricStats = {
      total: batch.messages.length,
      succeeded: 0,
      retried: 0,
      skipped: 0,
      direct: 0,
      ai: 0,
      keyword: 0,
    };
    const indexNowUrls = new Set<string>();

    for (const message of batch.messages) {
      try {
        log.log(`Processing message ID: ${message.id}`);
        const preloadedSkill = preloadedSkillsById.has(message.body.skillId)
          ? (preloadedSkillsById.get(message.body.skillId) ?? null)
          : undefined;
        const result = await processMessage(message.body, env, preloadedSkill);
        batchMetricStats.succeeded += 1;
        if (result === null) {
          batchMetricStats.skipped += 1;
        } else {
          batchMetricStats[result.method] += 1;
          for (const url of buildIndexNowCategoryUrls(result.affectedCategorySlugs, env)) {
            indexNowUrls.add(url);
          }
        }
        message.ack();
        log.log(`Message acknowledged: ${message.id}`);
      } catch (error) {
        batchMetricStats.retried += 1;
        log.error(`Error processing message ${message.id}:`, error);
        message.retry();
        log.log(`Message scheduled for retry: ${message.id}`);
      }
    }

    writeClassificationBatchMetric(
      env,
      batchMetricStats,
      preloadStatus
    );

    if (indexNowUrls.size > 0) {
      const indexNowTask = scheduleIndexNowSubmission({
        env,
        urls: [...indexNowUrls],
        source: `classification:batch:${batch.messages.length}`,
        waitUntil: ctx.waitUntil?.bind(ctx),
      });
      if (indexNowTask) await indexNowTask;
    }
  },
};
