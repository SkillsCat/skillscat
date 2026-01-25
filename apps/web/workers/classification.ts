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

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Default free model if not configured via environment variable
const DEFAULT_FREE_MODEL = 'liquid/lfm-2.5-1.2b-thinking:free';

// Extended message type with metadata for admission decision
interface ClassificationMessageWithMeta extends ClassificationMessage {
  stars?: number;
  topics?: string[];
  description?: string;
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

function buildClassificationPrompt(skillMdContent: string): string {
  const categoriesDescription = CATEGORIES.map(
    (c) => `- ${c.slug}: ${c.name} - ${c.description} (keywords: ${c.keywords.join(', ')})`
  ).join('\n');

  return `You are a skill classifier for Claude Code skills. Analyze the following SKILL.md content and classify it into 1-3 most relevant categories.

Available categories:
${categoriesDescription}

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

function classifyByKeywords(content: string): ClassificationResult {
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

async function classifyWithAI(
  skillMdContent: string,
  env: ClassificationEnv
): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(skillMdContent);

  if (!env.OPENROUTER_API_KEY) {
    console.log('No OpenRouter API key, falling back to keywords');
    return classifyByKeywords(skillMdContent);
  }

  // Use configured model or default free model
  const model = env.AI_MODEL || DEFAULT_FREE_MODEL;

  try {
    console.log(`Using model: ${model}`);
    return await callOpenRouter(prompt, model, env.OPENROUTER_API_KEY);
  } catch (error) {
    console.error(`Model ${model} failed:`, error);
    // Fallback to keyword classification if AI fails
    console.log('AI classification failed, falling back to keywords');
    return classifyByKeywords(skillMdContent);
  }
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
  const { skillId, repoOwner, repoName, skillMdPath, stars = 0, topics = [], description = '' } = message;

  console.log(`Processing skill: ${skillId} (${repoOwner}/${repoName})`);

  // Determine classification method based on repo metadata
  const method = determineClassificationMethod(repoOwner, stars, topics, description);
  console.log(`Classification method for ${skillId}: ${method}`);

  // Record metric
  await recordClassificationMetric(env, method);

  // Skip classification for low-quality repos
  if (method === 'skipped') {
    console.log(`Skipping classification for low-quality repo: ${skillId}`);
    const now = Date.now();
    await env.DB.prepare('UPDATE skills SET classification_method = ?, updated_at = ? WHERE id = ?')
      .bind('skipped', now, skillId)
      .run();
    return;
  }

  // Get SKILL.md content
  const r2Object = await env.R2.get(skillMdPath);
  if (!r2Object) {
    console.error(`SKILL.md not found in R2: ${skillMdPath}`);
    return;
  }

  const skillMdContent = await r2Object.text();

  let result: ClassificationResult;

  if (method === 'ai') {
    result = await classifyWithAI(skillMdContent, env);
  } else {
    result = classifyByKeywords(skillMdContent);
  }

  console.log(
    `Classification result for ${skillId}:`,
    result.categories,
    `(confidence: ${result.confidence}, method: ${method})`
  );

  await saveClassification(skillId, result, method, env);

  console.log(`Classification saved for skill: ${skillId}`);
}

export default {
  async queue(
    batch: MessageBatch<ClassificationMessageWithMeta>,
    env: ClassificationEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error(`Error processing message:`, error);
        message.retry();
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