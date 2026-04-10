import type { ClassificationMessage, IndexingMessage, SecurityAnalysisMessage } from './messages';

export interface BaseEnv {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  PUBLIC_APP_URL?: string;
  GITHUB_TOKEN?: string;
  GITHUB_TOKENS?: string;
  WORKER_SECRET?: string;
  CACHE_VERSION?: string;
  INDEXNOW_ENABLED?: string;
  INDEXNOW_KEY?: string;
  INDEXNOW_KEY_LOCATION?: string;
  INDEXNOW_API_URL?: string;
  INDEXNOW_DEDUPE_TTL_SECONDS?: string;
}

export interface GithubEventsEnv extends BaseEnv {
  INDEXING_QUEUE: Queue<IndexingMessage>;
  GITHUB_EVENTS_PER_PAGE?: string;
  GITHUB_EVENTS_PAGES?: string;
  GITHUB_EVENTS_MIN_REST_REMAINING?: string;
  GITHUB_EVENTS_REST_RESERVE?: string;
  GITHUB_SEARCH_DISCOVERY_ENABLED?: string;
  GITHUB_SEARCH_DISCOVERY_QUERY?: string;
  GITHUB_SEARCH_DISCOVERY_PAGES?: string;
  GITHUB_SEARCH_DISCOVERY_PER_PAGE?: string;
  GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS?: string;
  GITHUB_DISCOVERY_MIN_REST_REMAINING?: string;
  GITHUB_DISCOVERY_REST_RESERVE?: string;
  GITHUB_DISCOVERY_LOCK_TTL_SECONDS?: string;
}

export interface IndexingEnv extends BaseEnv {
  INDEXING_QUEUE: Queue<IndexingMessage>;
  CLASSIFICATION_QUEUE: Queue<ClassificationMessage>;
  SECURITY_ANALYSIS_QUEUE?: Queue<SecurityAnalysisMessage>;
  GITHUB_API_VERSION?: string;
}

export interface ClassificationEnv extends BaseEnv {
  OPENROUTER_API_KEY?: string;
  AI_MODEL?: string;
  CLASSIFICATION_PAID_MODEL?: string;
  FREE_MODELS?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface TrendingEnv extends BaseEnv {
  TRENDING_DECAY_HOURS?: string;
  TRENDING_STAR_WEIGHT?: string;
  TRENDING_FORK_WEIGHT?: string;
  TRENDING_VIEW_WEIGHT?: string;
  CLASSIFICATION_QUEUE?: Queue<ClassificationMessage>;
  SECURITY_ANALYSIS_QUEUE?: Queue<SecurityAnalysisMessage>;
  SECURITY_PREMIUM_TOP_N?: string;
}

export interface SearchPrecomputeEnv {
  DB: D1Database;
  WORKER_SECRET?: string;
  APP_ORIGIN?: string;
  SITEMAP_REFRESH_ENABLED?: string;
  SITEMAP_REFRESH_TIMEOUT_MS?: string;
  RECOMMEND_PRECOMPUTE_ENABLED?: string;
  RECOMMEND_PRECOMPUTE_MAX_PER_RUN?: string;
  RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS?: string;
  RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS?: string;
  RECOMMEND_ALGO_VERSION?: string;
  RECOMMEND_MISSING_STATE_SCAN_HOUR_UTC?: string;
  RECOMMEND_MISSING_STATE_SCAN_LIMIT?: string;
  SEARCH_PRECOMPUTE_ENABLED?: string;
  SEARCH_PRECOMPUTE_MAX_PER_RUN?: string;
  SEARCH_PRECOMPUTE_TIME_BUDGET_MS?: string;
  SEARCH_PRECOMPUTE_ALGO_VERSION?: string;
  SEARCH_MISSING_STATE_SCAN_HOUR_UTC?: string;
  SEARCH_MISSING_STATE_SCAN_LIMIT?: string;
}

export interface SecurityAnalysisEnv extends BaseEnv {
  INDEXING_QUEUE?: Queue<IndexingMessage>;
  OPENROUTER_API_KEY?: string;
  SECURITY_FREE_MODEL?: string;
  SECURITY_FREE_MODELS?: string;
  SECURITY_PREMIUM_MODEL?: string;
  SECURITY_MAX_AI_FILES?: string;
  SECURITY_MAX_AI_TEXT_BYTES?: string;
  SECURITY_STABILITY_ROUNDS?: string;
  SECURITY_HEURISTIC_THRESHOLD?: string;
  VIRUSTOTAL_DAILY_REQUEST_BUDGET?: string;
}

export interface VirusTotalEnv extends BaseEnv {
  VIRUSTOTAL_API_KEY?: string;
  VT_ENABLED?: string;
  VT_DAILY_REQUEST_BUDGET?: string;
  VT_MINUTE_REQUEST_BUDGET?: string;
  VT_UPLOAD_MAX_BYTES?: string;
  GITHUB_API_VERSION?: string;
}
