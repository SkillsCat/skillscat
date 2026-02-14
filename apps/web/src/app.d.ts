/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace App {
    interface Platform {
      env: {
        DB: D1Database;
        R2: R2Bucket;
        KV: KVNamespace;
        INDEXING_QUEUE: Queue;
        CLASSIFICATION_QUEUE: Queue;
        GITHUB_CLIENT_ID: string;
        GITHUB_CLIENT_SECRET: string;
        BETTER_AUTH_SECRET: string;
        OPENROUTER_API_KEY: string;
        DEEPSEEK_API_KEY: string;
        GITHUB_TOKEN?: string;
        WORKER_SECRET?: string;
        CACHE_VERSION?: string;
        RATE_LIMIT_BURST_WINDOW_SECONDS?: string;
        RATE_LIMIT_BURST_THRESHOLD?: string;
        RATE_LIMIT_MAX_PENALTY_LEVEL?: string;
        RATE_LIMIT_PENALTY_TTL_LEVEL_1_SECONDS?: string;
        RATE_LIMIT_PENALTY_TTL_LEVEL_2_SECONDS?: string;
        RATE_LIMIT_PENALTY_TTL_LEVEL_3_SECONDS?: string;
      };
      context: ExecutionContext;
      caches: CacheStorage & { default: Cache };
    }
    interface Locals {
      user: import('$lib/server/auth').User | null;
      session: import('$lib/server/auth').Session | null;
      auth: () => Promise<{ user: import('$lib/server/auth').User | null }>;
    }
    // interface Error {}
    // interface PageData {}
    // interface PageState {}
  }
}

export {};
