/**
 * Classification Worker
 *
 * Cost-optimized skill classification with admission threshold:
 * - AI classification for high-quality repos (stars>=100 or known orgs)
 * - Keyword-based for repos with sufficient metadata
 * - Skip classification for low-quality repos
 *
 * Expected to reduce AI API calls by ~85%
 */

import type {
  ClassificationEnv,
  ClassificationMessage,
  ClassificationResult,
  OpenRouterResponse,
  ClassificationMethod,
} from './shared/types';
import { KNOWN_ORGS } from './shared/types';
import { CATEGORIES, getCategorySlugs } from './shared/categories';
import { createLogger } from './shared/utils';

const log = createLogger('Classification');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

// Extended message type with metadata for admission decision
interface ClassificationMessageWithMeta extends ClassificationMessage {
  stars?: number;
  topics?: string[];
  description?: string;
  tags?: string[]; // Tags from SKILL.md frontmatter for classification hints
  frontmatterCategories?: string[]; // Direct categories from frontmatter
}

/**
 * Determine the classification method based on repo metadata
 * This is the core cost optimization logic
 */
function determineClassificationMethod(
  repoOwner: string,
  stars: number,
  topics: string[],
  description: string | null
): ClassificationMethod {
  // High-quality repos always get AI classification
  if (stars >= 100) {
    return 'ai';
  }

  // Known organizations always get AI classification
  if (KNOWN_ORGS.includes(repoOwner.toLowerCase() as typeof KNOWN_ORGS[number])) {
    return 'ai';
  }

  // Repos with sufficient metadata can use keyword classification
  if (topics.length >= 2) {
    return 'keyword';
  }

  // Repos with good description can use keyword classification
  if (description && description.length > 50) {
    return 'keyword';
  }

  // Low-quality repos: skip classification entirely
  if (stars < 10 && topics.length === 0 && (!description || description.length < 20)) {
    return 'skipped';
  }

  // Default to keyword classification
  return 'keyword';
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

function buildClassificationPrompt(skillMdContent: string, tags?: string[]): string {
  const categoriesDescription = CATEGORIES.map(
    (c) => `- ${c.slug}: ${c.name} - ${c.description} (keywords: ${c.keywords.join(', ')})`
  ).join('\n');

  let tagsHint = '';
  if (tags && tags.length > 0) {
    tagsHint = `\n\nAuthor-provided tags (use as hints for classification): ${tags.join(', ')}\n`;
  }

  return `You are a skill classifier for Claude Code skills. Analyze the following SKILL.md content and classify it into 1-3 most relevant categories.

Available categories:
${categoriesDescription}
${tagsHint}
SKILL.md content:
---
${skillMdContent.slice(0, 4000)}
---

Respond with a JSON object containing:
- categories: array of category slugs (1-3 items, most relevant first)
- confidence: number between 0 and 1
- reasoning: brief explanation of why these categories were chosen

Example response:
{"categories": ["git", "automation"], "confidence": 0.85, "reasoning": "This skill automates git commit message generation"}

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
      'HTTP-Referer': 'https://skillscat.dev',
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
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data: OpenRouterResponse = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenRouter response');
  }

  return parseClassificationResult(content);
}

function parseClassificationResult(content: string): ClassificationResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const result = JSON.parse(jsonMatch[0]);
  const validSlugs = getCategorySlugs();

  const categories = (result.categories || [])
    .filter((slug: string) => validSlugs.includes(slug))
    .slice(0, 3);

  if (categories.length === 0) {
    categories.push('productivity');
  }

  return {
    categories,
    confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
    reasoning: result.reasoning,
  };
}

/**
 * Get free models list from environment variable
 * Returns empty array if not configured
 */
function getFreeModels(env: ClassificationEnv): string[] {
  if (env.FREE_MODELS) {
    return env.FREE_MODELS.split(',').map((m) => m.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Pick a random model from the list, excluding the specified model
 */
function pickRandomModel(models: string[], exclude: string): string | null {
  const available = models.filter((m) => m !== exclude);
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
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

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in DeepSeek response');
  }

  return parseClassificationResult(content);
}

function classifyByKeywords(content: string, tags?: string[]): ClassificationResult {
  const contentLower = content.toLowerCase();
  const scores: Record<string, number> = {};

  for (const category of CATEGORIES) {
    let score = 0;
    for (const keyword of category.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = contentLower.match(regex);
      if (matches) {
        score += matches.length;
      }
      // Boost score if tag matches category keyword
      if (tags?.some((tag) => tag.toLowerCase() === keyword.toLowerCase())) {
        score += 3; // Significant boost for tag match
      }
    }
    // Also check if any tag directly matches the category slug
    if (tags?.some((tag) => tag.toLowerCase() === category.slug.toLowerCase())) {
      score += 5; // Strong boost for direct category match
    }
    if (score > 0) {
      scores[category.slug] = score;
    }
  }

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  if (sorted.length === 0) {
    return {
      categories: ['productivity'],
      confidence: 0.3,
      reasoning: 'No keywords matched, defaulting to productivity',
    };
  }

  return {
    categories: sorted.map(([slug]) => slug),
    confidence: 0.6,
    reasoning: 'Classified by keyword matching',
  };
}

/**
 * Classify skill using AI with multi-model fallback strategy:
 * 1. Try primary model on OpenRouter (AI_MODEL env var)
 * 2. Retry primary model once
 * 3. Try random fallback model from FREE_MODELS pool
 * 4. Try DeepSeek as final AI fallback
 * 5. Fall back to keyword classification
 */
async function classifyWithAI(
  skillMdContent: string,
  env: ClassificationEnv,
  tags?: string[]
): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(skillMdContent, tags);
  const freeModels = getFreeModels(env);
  const primaryModel = env.AI_MODEL || freeModels[0];

  // 1. Try OpenRouter (if API key and model are available)
  if (env.OPENROUTER_API_KEY && primaryModel) {
    // 1a. Primary model - first attempt
    try {
      console.log(`[OpenRouter] Trying primary model: ${primaryModel}`);
      return await callOpenRouter(prompt, primaryModel, env.OPENROUTER_API_KEY);
    } catch (error) {
      console.error(`[OpenRouter] Primary model failed:`, error);
    }

    // 1b. Primary model - retry
    try {
      console.log(`[OpenRouter] Retrying primary model: ${primaryModel}`);
      return await callOpenRouter(prompt, primaryModel, env.OPENROUTER_API_KEY);
    } catch (error) {
      console.error(`[OpenRouter] Primary model retry failed:`, error);
    }

    // 1c. Random fallback model from pool (if configured)
    const fallbackModel = pickRandomModel(freeModels, primaryModel);
    if (fallbackModel) {
      try {
        console.log(`[OpenRouter] Trying fallback model: ${fallbackModel}`);
        return await callOpenRouter(prompt, fallbackModel, env.OPENROUTER_API_KEY);
      } catch (error) {
        console.error(`[OpenRouter] Fallback model failed:`, error);
      }
    }
  } else if (!env.OPENROUTER_API_KEY) {
    console.log('[OpenRouter] No API key configured');
  } else if (!primaryModel) {
    console.log('[OpenRouter] No model configured (set AI_MODEL or FREE_MODELS)');
  }

  // 2. DeepSeek fallback
  if (env.DEEPSEEK_API_KEY) {
    try {
      console.log(`[DeepSeek] Trying ${DEEPSEEK_MODEL} as fallback`);
      return await callDeepSeek(prompt, env.DEEPSEEK_API_KEY);
    } catch (error) {
      console.error(`[DeepSeek] Failed:`, error);
    }
  }

  // 3. Final fallback to keyword classification
  console.log('[Fallback] All AI providers failed, using keyword classification');
  return classifyByKeywords(skillMdContent, tags);
}

async function saveClassification(
  skillId: string,
  result: ClassificationResult,
  method: ClassificationMethod,
  env: ClassificationEnv
): Promise<void> {
  const now = Date.now();

  await env.DB.prepare('DELETE FROM skill_categories WHERE skill_id = ?')
    .bind(skillId)
    .run();

  for (let i = 0; i < result.categories.length; i++) {
    const categorySlug = result.categories[i];
    const isPrimary = i === 0;

    await env.DB.prepare(`
      INSERT INTO skill_categories (skill_id, category_slug, is_primary, confidence, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
      .bind(skillId, categorySlug, isPrimary ? 1 : 0, result.confidence, now)
      .run();
  }

  // Update skill with classification method
  await env.DB.prepare('UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?')
    .bind(method, now, skillId)
    .run();
}

/**
 * Record classification metrics to KV
 */
async function recordClassificationMetric(
  env: ClassificationEnv,
  method: ClassificationMethod
): Promise<void> {
  const hourKey = `metrics:classification:${new Date().toISOString().slice(0, 13)}`;

  const existing = await env.KV.get(hourKey, 'json') as Record<string, number> | null;
  const updated = {
    ai: (existing?.ai || 0) + (method === 'ai' ? 1 : 0),
    keyword: (existing?.keyword || 0) + (method === 'keyword' ? 1 : 0),
    skipped: (existing?.skipped || 0) + (method === 'skipped' ? 1 : 0),
    direct: (existing?.direct || 0) + (method === 'direct' ? 1 : 0),
    total: (existing?.total || 0) + 1,
  };

  await env.KV.put(hourKey, JSON.stringify(updated), {
    expirationTtl: 7 * 24 * 60 * 60, // 7 days
  });
}

async function processMessage(
  message: ClassificationMessageWithMeta,
  env: ClassificationEnv
): Promise<void> {
  const { skillId, repoOwner, repoName, skillMdPath, stars = 0, topics = [], description = '', tags = [], frontmatterCategories } = message;

  log.log(`Processing skill: ${skillId} (${repoOwner}/${repoName})`, JSON.stringify(message));
  if (tags.length > 0) {
    log.log(`Tags from frontmatter: ${tags.join(', ')}`);
  }
  if (frontmatterCategories && frontmatterCategories.length > 0) {
    log.log(`Frontmatter categories: ${frontmatterCategories.join(', ')}`);
  }

  // Try direct category match first (cheapest - no AI or keyword matching needed)
  const directMatch = tryDirectCategoryMatch(frontmatterCategories);
  if (directMatch) {
    log.log(`Direct category match for ${skillId}: ${directMatch.categories.join(', ')}`);

    // Record metric for direct classification
    try {
      await recordClassificationMetric(env, 'direct');
      log.log(`Metric recorded for ${skillId}: direct`);
    } catch (metricError) {
      log.error(`Failed to record metric for ${skillId}:`, metricError);
    }

    // Save classification and return early
    try {
      await saveClassification(skillId, directMatch, 'direct', env);
      log.log(`Successfully saved direct classification for skill: ${skillId}, categories: ${directMatch.categories.join(', ')}`);
    } catch (saveError) {
      log.error(`Failed to save direct classification for ${skillId}:`, saveError);
      throw saveError;
    }
    return;
  }

  // Determine classification method based on repo metadata
  const method = determineClassificationMethod(repoOwner, stars, topics, description);
  log.log(`Method for ${skillId}: ${method} (stars: ${stars}, topics: ${topics.length}, desc length: ${description?.length || 0})`);

  // Record metric
  try {
    await recordClassificationMetric(env, method);
    log.log(`Metric recorded for ${skillId}: ${method}`);
  } catch (metricError) {
    log.error(`Failed to record metric for ${skillId}:`, metricError);
    // Don't fail the whole process for metric errors
  }

  // Skip classification for low-quality repos
  if (method === 'skipped') {
    log.log(`Skipping classification for low-quality repo: ${skillId}`);
    const now = Date.now();
    try {
      await env.DB.prepare('UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?')
        .bind('skipped', now, skillId)
        .run();
      log.log(`Updated skill as skipped: ${skillId}`);
    } catch (dbError) {
      log.error(`Failed to update skill as skipped: ${skillId}`, dbError);
      throw dbError;
    }
    return;
  }

  // Get SKILL.md content
  log.log(`Fetching SKILL.md from R2: ${skillMdPath}`);
  const r2Object = await env.R2.get(skillMdPath);
  if (!r2Object) {
    log.error(`SKILL.md not found in R2: ${skillMdPath}`);
    return;
  }

  const skillMdContent = await r2Object.text();
  log.log(`SKILL.md content length: ${skillMdContent.length} chars`);

  let result: ClassificationResult;

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
    `(confidence: ${result.confidence}, method: ${method}, reasoning: ${result.reasoning})`
  );

  try {
    await saveClassification(skillId, result, method, env);
    log.log(`Successfully saved classification for skill: ${skillId}, categories: ${result.categories.join(', ')}`);
  } catch (saveError) {
    log.error(`Failed to save classification for ${skillId}:`, saveError);
    throw saveError;
  }
}

export default {
  async queue(
    batch: MessageBatch<ClassificationMessageWithMeta>,
    env: ClassificationEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    log.log(`Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        log.log(`Processing message ID: ${message.id}`);
        await processMessage(message.body, env);
        message.ack();
        log.log(`Message acknowledged: ${message.id}`);
      } catch (error) {
        log.error(`Error processing message ${message.id}:`, error);
        message.retry();
        log.log(`Message scheduled for retry: ${message.id}`);
      }
    }
  },

  async fetch(
    request: Request,
    env: ClassificationEnv,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Metrics endpoint for monitoring
    if (url.pathname === '/metrics') {
      const hourKey = `metrics:classification:${new Date().toISOString().slice(0, 13)}`;
      const metrics = await env.KV.get(hourKey, 'json');
      return new Response(JSON.stringify(metrics || {}), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};