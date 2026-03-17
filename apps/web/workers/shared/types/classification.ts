export interface Category {
  slug: string;
  name: string;
  description: string;
  emoji: string;
  keywords: string[];
}

export interface ClassificationResult {
  categories: string[];
  confidence: number;
  reasoning?: string;
}

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
    cost?: number;
  };
}

export const KNOWN_ORGS = [
  'anthropics',
  'openai',
  'google',
  'microsoft',
  'facebook',
  'meta',
  'vercel',
  'cloudflare',
  'supabase',
  'prisma',
  'drizzle-team',
  'sveltejs',
  'vuejs',
  'reactjs',
] as const;
