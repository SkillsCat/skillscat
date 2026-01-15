/**
 * Classification Worker
 *
 * 消费 classification 队列，使用 AI 对 skill 进行分类
 * - 从 R2 读取 SKILL.md 内容
 * - 调用 AI API 进行分类
 * - 更新 skill_categories 表
 */

import type {
  Env,
  ClassificationMessage,
  ClassificationResult,
  OpenRouterResponse,
} from './types';
import { CATEGORIES, getCategorySlugs } from './categories';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * 构建分类 prompt
 */
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

/**
 * 调用 OpenRouter API
 */
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

/**
 * 调用 DeepSeek API
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
      model: 'deepseek-chat',
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
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data: OpenRouterResponse = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in DeepSeek response');
  }

  return parseClassificationResult(content);
}

/**
 * 解析分类结果
 */
function parseClassificationResult(content: string): ClassificationResult {
  // 尝试提取 JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  const result = JSON.parse(jsonMatch[0]);
  const validSlugs = getCategorySlugs();

  // 验证 categories
  const categories = (result.categories || [])
    .filter((slug: string) => validSlugs.includes(slug))
    .slice(0, 3);

  if (categories.length === 0) {
    // 默认分类
    categories.push('productivity');
  }

  return {
    categories,
    confidence: Math.min(1, Math.max(0, result.confidence || 0.5)),
    reasoning: result.reasoning,
  };
}

/**
 * 使用关键词进行简单分类 (fallback)
 */
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

  // 按分数排序
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
 * 执行分类
 */
async function classify(
  skillMdContent: string,
  env: Env
): Promise<ClassificationResult> {
  const prompt = buildClassificationPrompt(skillMdContent);

  // 尝试主要 AI 模型
  if (env.OPENROUTER_API_KEY) {
    try {
      const model = env.AI_MODEL || 'deepseek/deepseek-chat';
      return await callOpenRouter(prompt, model, env.OPENROUTER_API_KEY);
    } catch (error) {
      console.error('OpenRouter API failed:', error);
    }
  }

  // 尝试 DeepSeek 备用
  if (env.DEEPSEEK_API_KEY) {
    try {
      return await callDeepSeek(prompt, env.DEEPSEEK_API_KEY);
    } catch (error) {
      console.error('DeepSeek API failed:', error);
    }
  }

  // Fallback: 关键词分类
  console.log('Using keyword-based classification as fallback');
  return classifyByKeywords(skillMdContent);
}

/**
 * 保存分类结果到数据库
 */
async function saveClassification(
  skillId: string,
  result: ClassificationResult,
  env: Env
): Promise<void> {
  const now = Date.now();

  // 删除旧的分类
  await env.DB.prepare('DELETE FROM skill_categories WHERE skill_id = ?')
    .bind(skillId)
    .run();

  // 插入新的分类
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

  // 更新 skill 的 updated_at
  await env.DB.prepare('UPDATE skills SET updated_at = ? WHERE id = ?')
    .bind(now, skillId)
    .run();
}

/**
 * 处理单个消息
 */
async function processMessage(
  message: ClassificationMessage,
  env: Env
): Promise<void> {
  const { skillId, repoOwner, repoName, skillMdPath } = message;

  console.log(`Classifying skill: ${skillId} (${repoOwner}/${repoName})`);

  // 1. 从 R2 读取 SKILL.md
  const r2Object = await env.R2.get(skillMdPath);
  if (!r2Object) {
    console.error(`SKILL.md not found in R2: ${skillMdPath}`);
    return;
  }

  const skillMdContent = await r2Object.text();

  // 2. 执行分类
  const result = await classify(skillMdContent, env);

  console.log(
    `Classification result for ${skillId}:`,
    result.categories,
    `(confidence: ${result.confidence})`
  );

  // 3. 保存分类结果
  await saveClassification(skillId, result, env);

  console.log(`Classification saved for skill: ${skillId}`);
}

export default {
  /**
   * Queue Consumer Handler
   */
  async queue(
    batch: MessageBatch<ClassificationMessage>,
    env: Env,
    ctx: ExecutionContext
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

  /**
   * HTTP Handler (用于健康检查)
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
