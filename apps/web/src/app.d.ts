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
        GOOGLE_CLIENT_ID: string;
        GOOGLE_CLIENT_SECRET: string;
        BETTER_AUTH_SECRET: string;
        OPENROUTER_API_KEY: string;
        DEEPSEEK_API_KEY: string;
        GITHUB_TOKEN?: string;
        GITLAB_TOKEN?: string;
      };
      context: ExecutionContext;
      caches: CacheStorage & { default: Cache };
    }
    interface Locals {
      user: import('$lib/server/auth').User | null;
      session: import('$lib/server/auth').Session | null;
      auth: () => Promise<{ user: { id: string; name?: string; email?: string; image?: string } | null }>;
    }
    // interface Error {}
    // interface PageData {}
    // interface PageState {}
  }
}

export {};
