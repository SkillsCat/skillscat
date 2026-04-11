/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace App {
    interface Platform {
      env: {
        DB: D1Database;
        R2: R2Bucket;
        KV: KVNamespace;
        PUBLIC_APP_URL?: string;
        INDEXING_QUEUE: Queue;
        CLASSIFICATION_QUEUE: Queue;
        CLASSIFICATION_ANALYTICS?: AnalyticsEngineDataset;
        SECURITY_ANALYSIS_QUEUE: Queue;
        METRICS_QUEUE: Queue;
        GITHUB_CLIENT_ID: string;
        GITHUB_CLIENT_SECRET: string;
        BETTER_AUTH_SECRET: string;
        OPENROUTER_API_KEY: string;
        DEEPSEEK_API_KEY: string;
        VIRUSTOTAL_API_KEY?: string;
        GITHUB_TOKEN?: string;
        GITHUB_TOKENS?: string;
        WORKER_SECRET?: string;
        CACHE_VERSION?: string;
        SITEMAP_REFRESH_MIN_INTERVAL_SECONDS?: string;
        INDEXNOW_ENABLED?: string;
        INDEXNOW_KEY?: string;
        INDEXNOW_KEY_LOCATION?: string;
        INDEXNOW_API_URL?: string;
        INDEXNOW_DEDUPE_TTL_SECONDS?: string;
        AI_MODEL?: string;
        CLASSIFICATION_PAID_MODEL?: string;
        FREE_MODELS?: string;
        SECURITY_FREE_MODEL?: string;
        SECURITY_FREE_MODELS?: string;
        SECURITY_PREMIUM_MODEL?: string;
        SECURITY_PREMIUM_TOP_N?: string;
        SECURITY_MAX_AI_FILES?: string;
        SECURITY_MAX_AI_TEXT_BYTES?: string;
        SECURITY_STABILITY_ROUNDS?: string;
        SECURITY_HEURISTIC_THRESHOLD?: string;
        VT_ENABLED?: string;
        VT_DAILY_REQUEST_BUDGET?: string;
        VT_MINUTE_REQUEST_BUDGET?: string;
        VT_UPLOAD_MAX_BYTES?: string;
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
      locale: import('$lib/i18n/config').SupportedLocale;
      localeSource: import('$lib/i18n/config').LocaleSource;
      htmlLang: string;
    }
    // interface Error {}
    // interface PageData {}
    // interface PageState {}
  }
}

export {};
