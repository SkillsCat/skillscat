/**
 * Classification Worker Types
 */

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Storage
  R2: R2Bucket;

  // Environment Variables
  OPENROUTER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
}

/**
 * Message received from Indexing Worker
 */
export interface ClassificationMessage {
  type: 'classify';
  skillId: string;
  repoOwner: string;
  repoName: string;
  skillMdPath: string; // R2 path
}

/**
 * Category definition (matches web app)
 */
export interface Category {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  keywords: string[];
}

/**
 * AI Classification Result
 */
export interface ClassificationResult {
  categories: string[]; // category slugs
  confidence: number;
  reasoning?: string;
}

/**
 * OpenRouter API Response
 */
export interface OpenRouterResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
