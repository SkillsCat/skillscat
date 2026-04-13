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
import { CATEGORIES, getCategorySlugs } from './shared/classification/categories';
import {
  getOpenRouterFreePauseUntil,
  isOpenRouterFreeModel,
  isOpenRouterFreePauseError,
  OpenRouterApiError,
  parseOpenRouterRetryAfterMs,
  pauseOpenRouterFreeModels,
} from './shared/ai/openrouter';
import { createLogger } from './shared/utils';
import { buildGithubSkillR2Keys, buildUploadSkillR2Key } from '../src/lib/skill-path';
import { invalidateCategoryCaches } from '../src/lib/server/cache/categories';
import { syncCategoryPublicStats } from '../src/lib/server/db/business/stats';
import { markRecommendDirty } from '../src/lib/server/ranking/recommend-precompute';
import { markSearchDirty } from '../src/lib/server/ranking/search-precompute';

const log = createLogger('Classification');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
// OpenRouter free router auto-selects a currently available free model.
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const DEFAULT_CLASSIFICATION_PAID_MODEL = 'openai/gpt-5.4-nano';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const KEYWORD_SCORE_CAP_PER_KEYWORD = 3;
const KEYWORD_SLUG_TAG_MATCH_BOOST = 6;
const KEYWORD_TAG_MATCH_BOOST = 4;
const KEYWORD_MIN_SECONDARY_SCORE = 3;
const KEYWORD_SECONDARY_SCORE_RATIO = 0.5;
const KEYWORD_MIN_TERTIARY_SCORE = 5;
const KEYWORD_TERTIARY_SCORE_RATIO = 0.85;

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

  const validSlugs = getCategorySlugs();
  const validCategories = frontmatterCategories
    .filter(cat => validSlugs.includes(cat.toLowerCase()))
    .slice(0, 3);

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
8. If the skill doesn't fit well into existing categories, you may suggest ONE new secondary category
9. Suggested categories should be specific and useful for developers (not too broad or too niche)

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
      temperature: 0.3,
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
  const validSlugs = getCategorySlugs();

  const categories = (result.categories || [])
    .filter((slug: string) => validSlugs.includes(slug))
    .slice(0, 3);

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
      !validSlugs.includes(suggested.slug) &&
      // Reasonable length limits
      suggested.slug.length <= 50 &&
      suggested.name.length <= 30 &&
      suggested.description.length <= 200
    ) {
      suggestedCategory = {
        slug: suggested.slug,
        name: suggested.name,
        description: suggested.description
      };
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
 * The primary AI model is included first when it is itself a free model.
 */
export function getFreeModelCandidates(env: ClassificationEnv): string[] {
  const configured = (env.FREE_MODELS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter(isOpenRouterFreeModel);
  const primary = env.AI_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  return Array.from(new Set(
    isOpenRouterFreeModel(primary)
      ? [primary, ...configured]
      : configured
  ));
}

/**
 * Call DeepSeek API for classification
 */
async function callDeepSeek(
  prompt: string,
  apiKey: string
): Promise<ClassificationResult> {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as Record<string, unknown>;

  // Log full response for debugging if structure is unexpected
  if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    console.error(`[DeepSeek] Unexpected response structure:`, JSON.stringify(data));
    throw new Error(`DeepSeek returned unexpected response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  const typedData = data as unknown as OpenRouterResponse;
  const content = typedData.choices[0]?.message?.content;

  if (!content) {
    console.error(`[DeepSeek] No content in response:`, JSON.stringify(data));
    throw new Error('No content in DeepSeek response');
  }

  return parseClassificationResult(content);
}

export function classifyByKeywords(content: string, tags?: string[]): ClassificationResult {
  const contentLower = content.toLowerCase();
  const normalizedTags = (tags || []).map((tag) => tag.toLowerCase().trim()).filter(Boolean);
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
    if (normalizedTags.includes(category.slug.toLowerCase())) {
      score += KEYWORD_SLUG_TAG_MATCH_BOOST;
    }

    if (score > 0) {
      scores[category.slug] = score;
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
 * 1. Try ordered OpenRouter free-model candidates (primary free model first)
 * 2. Retry the first free candidate once for transient errors
 * 3. Try the configured non-free primary model (if any)
 * 4. Try paid OpenRouter fallback for higher-priority classification throughput
 * 5. Try DeepSeek as final AI fallback
 * 6. Fall back to keyword classification
 */
async function classifyWithAI(
  skillMdContent: string,
  env: ClassificationEnv,
  tags?: string[]
): Promise<ExtendedClassificationResult> {
  const prompt = buildClassificationPrompt(skillMdContent, tags);
  const freeModels = getFreeModelCandidates(env);
  const primaryModel = env.AI_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const paidPrimaryModel = !isOpenRouterFreeModel(primaryModel) ? primaryModel : null;
  const paidModel = env.CLASSIFICATION_PAID_MODEL?.trim() || DEFAULT_CLASSIFICATION_PAID_MODEL;
  const now = Date.now();
  const freePausedUntil = await getOpenRouterFreePauseUntil(env.KV, now);
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
          await pauseOpenRouterFreeModels(env.KV, {
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

  // 2. Configured non-free primary model, if any.
  if (env.OPENROUTER_API_KEY) {
    if (paidPrimaryModel) {
      try {
        console.log(`[OpenRouter] Trying non-free primary model: ${paidPrimaryModel}`);
        return await callOpenRouter(prompt, paidPrimaryModel, env.OPENROUTER_API_KEY);
      } catch (error) {
        console.error(`[OpenRouter] Non-free primary model failed:`, error);
      }
    }
  }

  // 3. Paid OpenRouter fallback for higher-priority classification.
  if (env.OPENROUTER_API_KEY) {
    if (paidPrimaryModel === paidModel) {
      console.log(`[OpenRouter] Paid fallback model already attempted: ${paidModel}`);
    } else {
      try {
        console.log(`[OpenRouter] Trying paid fallback model: ${paidModel}`);
        return await callOpenRouter(prompt, paidModel, env.OPENROUTER_API_KEY);
      } catch (error) {
        console.error(`[OpenRouter] Paid fallback model failed:`, error);
      }
    }
  }

  // 4. DeepSeek fallback
  if (env.DEEPSEEK_API_KEY) {
    try {
      console.log(`[DeepSeek] Trying ${DEEPSEEK_MODEL} as fallback`);
      return await callDeepSeek(prompt, env.DEEPSEEK_API_KEY);
    } catch (error) {
      console.error(`[DeepSeek] Failed:`, error);
    }
  }

  // 5. Final fallback to keyword classification
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
  env: ClassificationEnv
): Promise<void> {
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

  await markRecommendDirty(env.DB, skillId, now);
  await markSearchDirty(env.DB, skillId, now);
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
        env.AI_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
        env.CLASSIFICATION_PAID_MODEL?.trim() || DEFAULT_CLASSIFICATION_PAID_MODEL,
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
): Promise<ClassificationMethod | null> {
  const { skillId, repoOwner, repoName, skillMdPath, stars = 0, tags = [], frontmatterCategories, isReclassification } = message;

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
        await saveClassification(skillId, directMatch, 'direct', env);
        log.log(`Successfully saved direct classification for skill: ${skillId}, categories: ${directMatch.categories.join(', ')}`);
      } catch (saveError) {
        log.error(`Failed to save direct classification for ${skillId}:`, saveError);
        throw saveError;
      }
      return 'direct';
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
    await saveClassification(skillId, result, method, env);
    log.log(`Successfully saved classification for skill: ${skillId}, categories: ${result.categories.join(', ')}`);
  } catch (saveError) {
    log.error(`Failed to save classification for ${skillId}:`, saveError);
    throw saveError;
  }

  return method;
}

export default {
  async queue(
    batch: MessageBatch<ClassificationMessageWithMeta>,
    env: ClassificationEnv,
    _ctx: ExecutionContext
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

    for (const message of batch.messages) {
      try {
        log.log(`Processing message ID: ${message.id}`);
        const preloadedSkill = preloadedSkillsById.has(message.body.skillId)
          ? (preloadedSkillsById.get(message.body.skillId) ?? null)
          : undefined;
        const method = await processMessage(message.body, env, preloadedSkill);
        batchMetricStats.succeeded += 1;
        if (method === null) {
          batchMetricStats.skipped += 1;
        } else {
          batchMetricStats[method] += 1;
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
  },
};
