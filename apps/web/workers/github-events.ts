/**
 * GitHub Events Worker
 *
 * 轮询 GitHub Events API 刷新已知仓库，并在预算允许时使用 Code Search 发现新仓库
 * （追头 + 日期切片回填），另有零 API 配额的 HTML 仓库搜索爬虫、GitHub Topics
 * 爬虫、Awesome 列表解析、X Recent Search 与 Bluesky 搜索补充发现
 * 通过 Cron Trigger 默认每 5 分钟执行一次
 */

import type { GithubEventsEnv, GitHubEvent, IndexingMessage } from './shared/types';
import {
  getGitHubRateLimitKVFromEnv,
  getGitHubRequestAuthFromEnv,
  withGitHubRateLimitKVOverride,
} from '../src/lib/server/github-client/env';
import {
  checkPublicSkillMdAtHead,
  fetchPublicSkillRepoSearchPage,
  PublicRepoSearchError,
} from '../src/lib/server/github-client/public-search';
import { getRateLimit, listPublicEvents, searchCode } from '../src/lib/server/github-client/rest';
import {
  isRateLimitSnapshotStale,
  readAggregatedRateLimitSnapshot,
  type GitHubRateLimitSnapshot,
} from '../src/lib/server/github-client/rate-limit-kv';
import {
  getGitHubTokenInputFromEnv,
  resolveGitHubTokenCandidates,
  resolveGitHubTokenIds,
} from '../src/lib/server/github-client/token-pool';
import {
  createMemoizedDurableObjectKvStore,
  isDurableObjectKvStore,
} from '../src/lib/server/state/client';

const DEFAULT_EVENTS_PER_PAGE = 100;
const DEFAULT_EVENTS_PAGES = 1;
const DEFAULT_EVENTS_KNOWN_REPOS_ONLY = true;
const DEFAULT_EVENTS_MAX_QUEUED_REPOS = 20;
const DEFAULT_EVENTS_MIN_REST_REMAINING = 1000;
const DEFAULT_EVENTS_REST_RESERVE = 300;
const DEFAULT_SEARCH_DISCOVERY_QUERY = 'filename:SKILL.md';
const DEFAULT_SEARCH_DISCOVERY_PAGES = 3;
const DEFAULT_SEARCH_DISCOVERY_PER_PAGE = 100;
const DEFAULT_SEARCH_DISCOVERY_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS = 5 * 60;
const DEFAULT_SEARCH_MIN_REMAINING = 2;
const DEFAULT_SEARCH_RESERVE = 2;
const DEFAULT_DISCOVERY_LOCK_TTL_SECONDS = 240;
const DEFAULT_REPO_QUEUE_DEDUP_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_EVENT_QUEUE_DEDUP_TTL_SECONDS = 5 * 60;
const DEFAULT_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_HTML_SEARCH_QUERIES = 'SKILL.md in:readme,agent skills in:readme,.claude/skills in:readme';
const DEFAULT_HTML_SEARCH_PAGES = 3;
const DEFAULT_HTML_SEARCH_MAX_CANDIDATES = 200;
const MAX_HTML_SEARCH_QUERIES = 8;
const MAX_HTML_SEARCH_PAGES = 10;
const MAX_HTML_SEARCH_CANDIDATES = 1000;
const MAX_DISCOVERY_PAGES = 10;
const MAX_DISCOVERY_PER_PAGE = 100;
const MAX_DISCOVERY_QUEUED_REPOS = 100;
const MAX_DISCOVERY_INTERVAL_SECONDS = 24 * 60 * 60;
const MAX_DISCOVERY_LOCK_TTL_SECONDS = 15 * 60;
const MAX_QUEUE_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SEARCH_BACKFILL_INTERVAL_SECONDS = 60 * 60;
const DEFAULT_SEARCH_BACKFILL_START_DATE = '2025-01-01';
const DEFAULT_SEARCH_BACKFILL_MIN_REMAINING = 5;
const DEFAULT_SEARCH_BACKFILL_RESERVE = 5;
const DEFAULT_SEARCH_BACKFILL_MAX_PAGES = 3;
const DEFAULT_X_SEARCH_QUERY = '("SKILL.md" OR "agent skill") (github.com OR github) -is:retweet has:links';
const DEFAULT_X_SEARCH_MAX_RESULTS = 50;
const DEFAULT_X_SEARCH_MAX_TWEETS = 200;
const DEFAULT_X_SEARCH_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_X_SEARCH_MAX_QUEUED_REPOS = 50;
const DEFAULT_X_SEARCH_MAX_REQUESTS_PER_DAY = 1;
const DEFAULT_X_SEARCH_MAX_REQUESTS_PER_MONTH = 30;
const MAX_X_SEARCH_REQUESTS_PER_DAY = 1000;
const MAX_X_SEARCH_REQUESTS_PER_MONTH = 10000;
const DEFAULT_TOPICS_LIST = 'claude-code-skill,claude-skills,agent-skills';
const DEFAULT_TOPICS_PAGES_PER_TOPIC = 2;
const DEFAULT_TOPICS_INTERVAL_SECONDS = 60 * 60;
const DEFAULT_TOPICS_MAX_QUEUED_REPOS = 50;
const MAX_TOPICS = 10;
const MAX_TOPICS_PAGES_PER_TOPIC = 5;
const DEFAULT_AWESOME_LIST_URLS = 'https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md';
const DEFAULT_AWESOME_LISTS_INTERVAL_SECONDS = 24 * 60 * 60;
const DEFAULT_AWESOME_LISTS_MAX_QUEUED_REPOS = 50;
const DEFAULT_AWESOME_LISTS_MAX_LISTS = 5;
const MAX_AWESOME_LISTS = 20;
const AWESOME_LIST_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_BSKY_SEARCH_QUERY = '"SKILL.md" github';
const DEFAULT_BSKY_SEARCH_INTERVAL_SECONDS = 15 * 60;
const DEFAULT_BSKY_SEARCH_MAX_RESULTS = 50;
const DEFAULT_BSKY_SEARCH_MAX_QUEUED_REPOS = 50;
const MAX_BSKY_SEARCH_RESULTS = 100;
const DISCOVERY_FETCH_TIMEOUT_MS = 15_000;

const RATE_LIMIT_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const D1_MAX_BOUND_PARAMETERS = 100;
const REPO_IDENTITY_BOUND_PARAMETERS = 2;
const D1_REPO_IDENTITY_CHUNK_SIZE = Math.floor(
  D1_MAX_BOUND_PARAMETERS / REPO_IDENTITY_BOUND_PARAMETERS
);

const RUN_LOCK_KEY = 'github-discovery:run-lock';
const CODE_SEARCH_CURSOR_KEY = 'github-events:code-search:last-head';
const CODE_SEARCH_BACKFILL_CURSOR_KEY = 'github-events:code-search:backfill-cursor';
const EVENT_REPLAY_STATE_KEY = 'github-events:event-replay-state';
const REPO_QUEUE_DEDUP_WINDOW_KEY = 'github-events:repo-queued-window';
const X_SEARCH_SINCE_ID_KEY = 'github-events:x-search:since-id';
const X_SEARCH_BUDGET_KEY_PREFIX = 'github-events:x-search:budget:';
const BSKY_SEARCH_SINCE_KEY = 'github-events:bsky-search:since';

interface SearchDiscoveryResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  allowedPages: number;
  stoppedByCursor: boolean;
  remainingAfter?: number;
  resetAtEpochSecAfter?: number;
  skippedReason?: string;
}

interface CodeSearchBackfillResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  allowedPages: number;
  date?: string;
  skippedReason?: string;
}

interface HtmlSearchDiscoveryResult {
  scanned: number;
  queued: number;
  pagesFetched: number;
  skippedReason?: string;
}

interface XSearchDiscoveryResult { scanned: number; queued: number; tweets: number; skippedReason?: string }
interface XSearchTweet { id?: string; text?: string; entities?: { urls?: Array<{ expanded_url?: string; url?: string }> } }
interface XSearchResponse { data?: XSearchTweet[]; meta?: { next_token?: string; newest_id?: string } }
interface XSearchBudgetConfig { maxRequestsPerDay: number; maxRequestsPerMonth: number }

interface GithubTopicsDiscoveryResult { scanned: number; queued: number; pagesFetched: number; skippedReason?: string }
interface AwesomeListsDiscoveryResult { scanned: number; queued: number; listsFetched: number; skippedReason?: string }
interface BskySearchDiscoveryResult { scanned: number; queued: number; posts: number; skippedReason?: string }
interface BskyPostRecordFacetFeature { $type?: string; uri?: string }
interface BskyPostRecord { text?: string; facets?: Array<{ features?: BskyPostRecordFacetFeature[] }> }
export interface BskyPost { uri?: string; record?: BskyPostRecord }
interface BskySearchResponse { posts?: BskyPost[] }

interface EventsDiscoveryResult {
  processed: number;
  queued: number;
  unknownSkipped: number;
  pagesFetched: number;
  allowedPages: number;
  skippedReason?: string;
}

interface RepoIdentity {
  owner: string;
  name: string;
}

type QueuedRepoSet = Set<string>;

interface RepoQueuedWindowPayload {
  entries?: Record<string, number>;
}

interface RepoQueueDedupeState {
  recentUntilByIdentity: Map<string, number>;
  queuedInRun: QueuedRepoSet;
  dirty: boolean;
}

interface GitHubEventsFetchResult {
  events: GitHubEvent[];
  rateLimited: boolean;
}

interface GitHubCodeSearchItem {
  sha: string;
  path: string;
  repository?: {
    full_name?: string;
  };
}

interface GitHubCodeSearchResponse {
  items?: GitHubCodeSearchItem[];
}

interface DiscoveryRunLockPayload {
  token: string;
  acquiredAtEpochMs: number;
  expiresAtEpochMs: number;
}

interface EventReplayStatePayload {
  baseLastEventId: string | null;
  processedPushEventIds: string[];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function parseClampedPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  return Math.min(parsePositiveInt(raw, fallback), max);
}

function parseEnabled(raw: string | undefined, fallback: boolean = true): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off' && normalized !== 'no';
}

function normalizeSkillPath(skillPath?: string): string {
  return (skillPath || '').replace(/^\/+|\/+$/g, '');
}

function parseRepoFullName(fullName: string | undefined): RepoIdentity | null {
  if (!fullName) return null;
  const [owner, name] = fullName.split('/');
  if (!owner || !name) return null;
  return { owner, name };
}

/** Extract a canonical github.com owner/repo from a tweet URL. */
export function parseGitHubRepoUrl(raw: string | undefined): RepoIdentity | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const invalid = new Set(['issues', 'pull', 'pulls', 'releases', 'actions', 'wiki', 'commit', 'commits', 'discussions', 'security', 'settings']);
    if (invalid.has(parts[0].toLowerCase()) || invalid.has(parts[1].toLowerCase())) return null;
    if (parts[2] && invalid.has(parts[2].toLowerCase())) return null;
    if (!/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+(?:\.git)?$/.test(parts[1])) return null;
    return { owner: parts[0], name: parts[1].replace(/\.git$/, '') };
  } catch { return null; }
}

export function extractGitHubReposFromTweet(tweet: XSearchTweet): RepoIdentity[] {
  const urls = tweet.entities?.urls || [];
  const seen = new Set<string>();
  const repos: RepoIdentity[] = [];
  const candidates = urls.map((entry) => entry.expanded_url || entry.url);
  if (tweet.text) {
    candidates.push(...(tweet.text.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[^\s<>]*)?/gi) || []));
  }
  for (const candidate of candidates) {
    const repo = parseGitHubRepoUrl(candidate);
    if (!repo) continue;
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (!seen.has(identity)) { seen.add(identity); repos.push(repo); }
  }
  return repos;
}

const GITHUB_TOPICS_PAGE_RESERVED_SEGMENTS = new Set([
  'topics', 'login', 'explore', 'features', 'marketplace', 'pricing', 'search',
  'settings', 'organizations', 'trending', 'collections', 'sponsors', 'about',
  'join', 'new', 'notifications', 'signup', 'site', 'support', 'contact', 'events',
]);

/**
 * 从 github.com/topics/<topic> 页面 HTML 提取仓库链接 href="/owner/repo"
 * (恰好两段路径,排除保留段),复用 parseGitHubRepoUrl 做字符与 .git 校验。
 */
export function extractReposFromGitHubTopicsHtml(html: string): RepoIdentity[] {
  const seen = new Set<string>();
  const repos: RepoIdentity[] = [];
  for (const match of html.matchAll(/href="\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)"/g)) {
    const [, owner, name] = match;
    if (GITHUB_TOPICS_PAGE_RESERVED_SEGMENTS.has(owner.toLowerCase())) continue;
    const repo = parseGitHubRepoUrl(`https://github.com/${owner}/${name}`);
    if (!repo) continue;
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    repos.push(repo);
  }
  return repos;
}

/** 从任意文本(markdown 等)中提取 github.com owner/repo 链接并去重。 */
export function extractGitHubReposFromText(text: string): RepoIdentity[] {
  const seen = new Set<string>();
  const repos: RepoIdentity[] = [];
  const candidates = text.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[^\s<>"'()\[\]]*)?/gi) || [];
  for (const candidate of candidates) {
    const repo = parseGitHubRepoUrl(candidate);
    if (!repo) continue;
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    repos.push(repo);
  }
  return repos;
}

/** 从 Bluesky 帖子的 record.text 与 link facets 中提取 GitHub 仓库并去重。 */
export function extractGitHubReposFromBskyPost(post: BskyPost): RepoIdentity[] {
  const seen = new Set<string>();
  const repos: RepoIdentity[] = [];
  const candidates: Array<string | undefined> = [];
  const record = post.record;
  if (record?.text) {
    candidates.push(...(record.text.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[^\s<>]*)?/gi) || []));
  }
  for (const facet of record?.facets || []) {
    for (const feature of facet.features || []) {
      if (feature.$type === 'app.bsky.richtext.facet#link') {
        candidates.push(feature.uri);
      }
    }
  }
  for (const candidate of candidates) {
    const repo = parseGitHubRepoUrl(candidate);
    if (!repo) continue;
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    repos.push(repo);
  }
  return repos;
}

function getSkillPathFromSkillMdPath(path: string): string | undefined {
  const normalized = path.replace(/^\/+/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return undefined;
  const parent = normalized.slice(0, idx);
  return parent || undefined;
}

function isSkillMdPath(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase();
  return name === 'skill.md';
}

function buildSearchFingerprint(item: GitHubCodeSearchItem): string | null {
  const repoFullName = item.repository?.full_name?.toLowerCase();
  const path = item.path?.toLowerCase();
  const sha = item.sha?.toLowerCase();
  if (!repoFullName || !path || !sha) return null;
  return `${repoFullName}#${path}#${sha}`;
}

function isGitHubRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after');
}

function getEventsPerPage(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_EVENTS_PER_PAGE, DEFAULT_EVENTS_PER_PAGE, MAX_DISCOVERY_PER_PAGE);
}

function getEventsDiscoveryConfig(env: GithubEventsEnv): {
  pages: number;
  perPage: number;
  knownReposOnly: boolean;
  maxQueuedRepos: number;
  cronIntervalSeconds: number;
  minRestRemaining: number;
  restReserve: number;
} {
  return {
    pages: parseClampedPositiveInt(env.GITHUB_EVENTS_PAGES, DEFAULT_EVENTS_PAGES, MAX_DISCOVERY_PAGES),
    perPage: getEventsPerPage(env),
    knownReposOnly: parseEnabled(
      env.GITHUB_EVENTS_KNOWN_REPOS_ONLY,
      DEFAULT_EVENTS_KNOWN_REPOS_ONLY
    ),
    maxQueuedRepos: parseClampedPositiveInt(
      env.GITHUB_EVENTS_MAX_QUEUED_REPOS,
      DEFAULT_EVENTS_MAX_QUEUED_REPOS,
      MAX_DISCOVERY_QUEUED_REPOS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    minRestRemaining: parsePositiveInt(
      env.GITHUB_EVENTS_MIN_REST_REMAINING,
      DEFAULT_EVENTS_MIN_REST_REMAINING
    ),
    restReserve: parsePositiveInt(env.GITHUB_EVENTS_REST_RESERVE, DEFAULT_EVENTS_REST_RESERVE),
  };
}

function getSearchDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean;
  query: string;
  pages: number;
  perPage: number;
  intervalSeconds: number;
  cronIntervalSeconds: number;
  minRestRemaining: number;
  restReserve: number;
} {
  return {
    enabled: parseEnabled(env.GITHUB_SEARCH_DISCOVERY_ENABLED, true),
    query: (env.GITHUB_SEARCH_DISCOVERY_QUERY || DEFAULT_SEARCH_DISCOVERY_QUERY).trim() || DEFAULT_SEARCH_DISCOVERY_QUERY,
    pages: parseClampedPositiveInt(env.GITHUB_SEARCH_DISCOVERY_PAGES, DEFAULT_SEARCH_DISCOVERY_PAGES, MAX_DISCOVERY_PAGES),
    perPage: parseClampedPositiveInt(env.GITHUB_SEARCH_DISCOVERY_PER_PAGE, DEFAULT_SEARCH_DISCOVERY_PER_PAGE, MAX_DISCOVERY_PER_PAGE),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      DEFAULT_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    minRestRemaining: parsePositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_MIN_REMAINING,
      DEFAULT_SEARCH_MIN_REMAINING
    ),
    restReserve: parsePositiveInt(
      env.GITHUB_SEARCH_DISCOVERY_RESERVE,
      DEFAULT_SEARCH_RESERVE
    ),
  };
}

function getDiscoveryLockTtlSeconds(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_DISCOVERY_LOCK_TTL_SECONDS, DEFAULT_DISCOVERY_LOCK_TTL_SECONDS, MAX_DISCOVERY_LOCK_TTL_SECONDS);
}

function getRepoQueueDedupTtlSeconds(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_REPO_QUEUE_DEDUP_TTL_SECONDS, DEFAULT_REPO_QUEUE_DEDUP_TTL_SECONDS, MAX_QUEUE_DEDUP_TTL_SECONDS);
}

function getEventQueueDedupTtlSeconds(env: GithubEventsEnv): number {
  return parseClampedPositiveInt(env.GITHUB_EVENT_QUEUE_DEDUP_TTL_SECONDS, DEFAULT_EVENT_QUEUE_DEDUP_TTL_SECONDS, MAX_QUEUE_DEDUP_TTL_SECONDS);
}

function parseDateOnly(raw: string | undefined, fallback: string): string {
  const value = (raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : fallback;
}

function formatDateOnly(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function addDaysToDateOnly(date: string, days: number): string {
  return formatDateOnly(Date.parse(`${date}T00:00:00Z`) + days * 86400_000);
}

function getHtmlSearchDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean;
  intervalSeconds: number;
  cronIntervalSeconds: number;
  queries: string[];
  pages: number;
  maxCandidates: number;
} {
  const rawQueries = (env.GITHUB_HTML_SEARCH_QUERIES || DEFAULT_HTML_SEARCH_QUERIES)
    .split(',')
    .map((query) => query.trim())
    .filter(Boolean);
  return {
    enabled: parseEnabled(env.GITHUB_HTML_SEARCH_DISCOVERY_ENABLED, true),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      DEFAULT_HTML_SEARCH_DISCOVERY_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    queries: rawQueries.length > 0
      ? rawQueries.slice(0, MAX_HTML_SEARCH_QUERIES)
      : [DEFAULT_HTML_SEARCH_QUERIES],
    pages: Math.min(
      parseClampedPositiveInt(env.GITHUB_HTML_SEARCH_PAGES, DEFAULT_HTML_SEARCH_PAGES, MAX_HTML_SEARCH_PAGES),
      MAX_HTML_SEARCH_PAGES
    ),
    maxCandidates: Math.min(
      parseClampedPositiveInt(env.GITHUB_HTML_SEARCH_MAX_CANDIDATES, DEFAULT_HTML_SEARCH_MAX_CANDIDATES, MAX_HTML_SEARCH_CANDIDATES),
      MAX_HTML_SEARCH_CANDIDATES
    ),
  };
}

function getXSearchDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean; query: string; maxResults: number; maxTweets: number;
  intervalSeconds: number; maxQueuedRepos: number; cronIntervalSeconds: number;
  budget: XSearchBudgetConfig;
} {
  return {
    enabled: parseEnabled(env.X_SEARCH_ENABLED, false) && Boolean(env.X_BEARER_TOKEN?.trim()),
    query: (env.X_SEARCH_QUERY || DEFAULT_X_SEARCH_QUERY).trim() || DEFAULT_X_SEARCH_QUERY,
    maxResults: Math.min(Math.max(parsePositiveInt(env.X_SEARCH_MAX_RESULTS, DEFAULT_X_SEARCH_MAX_RESULTS), 10), 100),
    maxTweets: Math.min(parseClampedPositiveInt(env.X_SEARCH_MAX_TWEETS, DEFAULT_X_SEARCH_MAX_TWEETS, MAX_HTML_SEARCH_CANDIDATES), MAX_HTML_SEARCH_CANDIDATES),
    intervalSeconds: parseClampedPositiveInt(env.X_SEARCH_INTERVAL_SECONDS, DEFAULT_X_SEARCH_INTERVAL_SECONDS, MAX_DISCOVERY_INTERVAL_SECONDS),
    maxQueuedRepos: parseClampedPositiveInt(env.X_SEARCH_MAX_QUEUED_REPOS, DEFAULT_X_SEARCH_MAX_QUEUED_REPOS, MAX_DISCOVERY_QUEUED_REPOS),
    cronIntervalSeconds: parseClampedPositiveInt(env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS, DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS, MAX_DISCOVERY_INTERVAL_SECONDS),
    budget: {
      maxRequestsPerDay: parseClampedPositiveInt(
        env.X_SEARCH_MAX_REQUESTS_PER_DAY,
        DEFAULT_X_SEARCH_MAX_REQUESTS_PER_DAY,
        MAX_X_SEARCH_REQUESTS_PER_DAY
      ),
      maxRequestsPerMonth: parseClampedPositiveInt(
        env.X_SEARCH_MAX_REQUESTS_PER_MONTH,
        DEFAULT_X_SEARCH_MAX_REQUESTS_PER_MONTH,
        MAX_X_SEARCH_REQUESTS_PER_MONTH
      ),
    },
  };
}

export function getGithubTopicsDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean; topics: string[]; pagesPerTopic: number;
  intervalSeconds: number; maxQueuedRepos: number; cronIntervalSeconds: number;
} {
  const rawTopics = (env.GITHUB_TOPICS_LIST || DEFAULT_TOPICS_LIST)
    .split(',')
    .map((topic) => topic.trim())
    .filter(Boolean);
  return {
    enabled: parseEnabled(env.GITHUB_TOPICS_ENABLED, true),
    topics: (rawTopics.length > 0 ? rawTopics : [DEFAULT_TOPICS_LIST]).slice(0, MAX_TOPICS),
    pagesPerTopic: parseClampedPositiveInt(
      env.GITHUB_TOPICS_PAGES_PER_TOPIC,
      DEFAULT_TOPICS_PAGES_PER_TOPIC,
      MAX_TOPICS_PAGES_PER_TOPIC
    ),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_TOPICS_INTERVAL_SECONDS,
      DEFAULT_TOPICS_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    maxQueuedRepos: parseClampedPositiveInt(
      env.GITHUB_TOPICS_MAX_QUEUED_REPOS,
      DEFAULT_TOPICS_MAX_QUEUED_REPOS,
      MAX_DISCOVERY_QUEUED_REPOS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
  };
}

export function getAwesomeListsDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean; urls: string[]; intervalSeconds: number;
  maxQueuedRepos: number; maxLists: number; cronIntervalSeconds: number;
} {
  const rawUrls = (env.AWESOME_LIST_URLS || DEFAULT_AWESOME_LIST_URLS)
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const maxLists = parseClampedPositiveInt(
    env.AWESOME_LISTS_MAX_LISTS,
    DEFAULT_AWESOME_LISTS_MAX_LISTS,
    MAX_AWESOME_LISTS
  );
  return {
    enabled: parseEnabled(env.AWESOME_LISTS_ENABLED, true),
    urls: (rawUrls.length > 0 ? rawUrls : [DEFAULT_AWESOME_LIST_URLS]).slice(0, maxLists),
    intervalSeconds: parseClampedPositiveInt(
      env.AWESOME_LISTS_INTERVAL_SECONDS,
      DEFAULT_AWESOME_LISTS_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    maxQueuedRepos: parseClampedPositiveInt(
      env.AWESOME_LISTS_MAX_QUEUED_REPOS,
      DEFAULT_AWESOME_LISTS_MAX_QUEUED_REPOS,
      MAX_DISCOVERY_QUEUED_REPOS
    ),
    maxLists,
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
  };
}

export function getBskySearchDiscoveryConfig(env: GithubEventsEnv): {
  enabled: boolean; query: string; intervalSeconds: number;
  maxResults: number; maxQueuedRepos: number; cronIntervalSeconds: number;
} {
  return {
    enabled: parseEnabled(env.BSKY_SEARCH_ENABLED, false),
    query: (env.BSKY_SEARCH_QUERY || DEFAULT_BSKY_SEARCH_QUERY).trim() || DEFAULT_BSKY_SEARCH_QUERY,
    intervalSeconds: parseClampedPositiveInt(
      env.BSKY_SEARCH_INTERVAL_SECONDS,
      DEFAULT_BSKY_SEARCH_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    maxResults: parseClampedPositiveInt(
      env.BSKY_SEARCH_MAX_RESULTS,
      DEFAULT_BSKY_SEARCH_MAX_RESULTS,
      MAX_BSKY_SEARCH_RESULTS
    ),
    maxQueuedRepos: parseClampedPositiveInt(
      env.BSKY_SEARCH_MAX_QUEUED_REPOS,
      DEFAULT_BSKY_SEARCH_MAX_QUEUED_REPOS,
      MAX_DISCOVERY_QUEUED_REPOS
    ),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
  };
}

export async function reserveXSearchRequest(
  store: KVNamespace,
  budget: XSearchBudgetConfig,
  nowMs: number
): Promise<boolean> {
  const date = new Date(nowMs);
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const dayKey = `${X_SEARCH_BUDGET_KEY_PREFIX}day:${day}`;
  const monthKey = `${X_SEARCH_BUDGET_KEY_PREFIX}month:${month}`;
  const [dayRaw, monthRaw] = await Promise.all([store.get(dayKey), store.get(monthKey)]);
  const dayCount = Number(dayRaw || 0);
  const monthCount = Number(monthRaw || 0);
  if (
    !Number.isFinite(dayCount) || !Number.isFinite(monthCount)
    || dayCount >= budget.maxRequestsPerDay
    || monthCount >= budget.maxRequestsPerMonth
  ) {
    return false;
  }
  await Promise.all([
    store.put(dayKey, String(dayCount + 1), { expirationTtl: 2 * 86400 }),
    store.put(monthKey, String(monthCount + 1), { expirationTtl: 32 * 86400 }),
  ]);
  return true;
}

function getSearchBackfillConfig(env: GithubEventsEnv): {
  enabled: boolean;
  intervalSeconds: number;
  startDate: string;
  minRemaining: number;
  reserve: number;
  maxPages: number;
  perPage: number;
  cronIntervalSeconds: number;
} {
  return {
    enabled: parseEnabled(env.GITHUB_SEARCH_BACKFILL_ENABLED, true),
    intervalSeconds: parseClampedPositiveInt(
      env.GITHUB_SEARCH_BACKFILL_INTERVAL_SECONDS,
      DEFAULT_SEARCH_BACKFILL_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
    startDate: parseDateOnly(env.GITHUB_SEARCH_BACKFILL_START_DATE, DEFAULT_SEARCH_BACKFILL_START_DATE),
    minRemaining: parsePositiveInt(
      env.GITHUB_SEARCH_BACKFILL_MIN_REMAINING,
      DEFAULT_SEARCH_BACKFILL_MIN_REMAINING
    ),
    reserve: parsePositiveInt(env.GITHUB_SEARCH_BACKFILL_RESERVE, DEFAULT_SEARCH_BACKFILL_RESERVE),
    maxPages: parseClampedPositiveInt(env.GITHUB_SEARCH_BACKFILL_MAX_PAGES, DEFAULT_SEARCH_BACKFILL_MAX_PAGES, MAX_DISCOVERY_PAGES),
    perPage: parseClampedPositiveInt(env.GITHUB_SEARCH_DISCOVERY_PER_PAGE, DEFAULT_SEARCH_DISCOVERY_PER_PAGE, MAX_DISCOVERY_PER_PAGE),
    cronIntervalSeconds: parseClampedPositiveInt(
      env.GITHUB_DISCOVERY_CRON_INTERVAL_SECONDS,
      DEFAULT_DISCOVERY_CRON_INTERVAL_SECONDS,
      MAX_DISCOVERY_INTERVAL_SECONDS
    ),
  };
}

function getGithubEventsStateStore(env: GithubEventsEnv): KVNamespace {
  return env.KV;
}

export function buildRepoQueuedDedupIdentity(owner: string, name: string, skillPath?: string): string {
  const normalizedPath = normalizeSkillPath(skillPath).toLowerCase();
  return `${owner.toLowerCase()}/${name.toLowerCase()}:${normalizedPath}`;
}

export function shouldRunSearchDiscoveryThisTick(
  nowMs: number,
  cronIntervalSeconds: number,
  searchIntervalSeconds: number
): boolean {
  const normalizedCronInterval = Math.max(1, Math.floor(cronIntervalSeconds));
  const normalizedSearchInterval = Math.max(1, Math.floor(searchIntervalSeconds));

  if (normalizedSearchInterval <= normalizedCronInterval) {
    return true;
  }

  const nowEpochSec = Math.floor(nowMs / 1000);
  return (nowEpochSec % normalizedSearchInterval) < normalizedCronInterval;
}

export function computeAllowedSearchPages(
  configuredPages: number,
  remaining: number,
  resetAtEpochSec: number,
  cronIntervalSeconds: number,
  reserve: number,
  nowMs: number = Date.now()
): number {
  if (configuredPages <= 0) return 0;

  const safeRemaining = Math.max(0, remaining - reserve);
  if (safeRemaining <= 0) return 0;

  const nowSec = Math.floor(nowMs / 1000);
  const secondsUntilReset = Math.max(0, resetAtEpochSec - nowSec);
  const runsUntilReset = Math.max(1, Math.ceil(secondsUntilReset / Math.max(1, cronIntervalSeconds)));
  const safeBudget = Math.floor(safeRemaining / runsUntilReset);

  return Math.min(configuredPages, Math.max(0, safeBudget));
}

/**
 * 获取 GitHub Events
 */
async function fetchGitHubEvents(
  env: GithubEventsEnv,
  page: number,
  perPage: number
): Promise<GitHubEventsFetchResult> {
  const response = await listPublicEvents({
    page,
    perPage,
    // Budget snapshots are refreshed explicitly via /rate_limit.
    // Keep discovery requests themselves write-free for KV cost control.
    ...getGitHubRequestAuthFromEnv(env, { rateLimitMode: 'read_only' }),
    userAgent: 'SkillsCat-Worker/1.0',
  });
  if (!response.ok) {
    if (isGitHubRateLimited(response)) {
      return { events: [], rateLimited: true };
    }
    throw new Error(`Failed to fetch GitHub events: ${response.status}`);
  }
  return {
    events: await response.json() as GitHubEvent[],
    rateLimited: false,
  };
}

/**
 * 从事件中提取仓库信息
 */
function extractRepoInfo(event: GitHubEvent): IndexingMessage | null {
  if (!event.repo) return null;

  const [owner, name] = event.repo.name.split('/');
  if (!owner || !name) return null;

  return {
    type: 'check_skill',
    repoOwner: owner,
    repoName: name,
    eventId: event.id,
    eventType: event.type,
    createdAt: event.created_at,
    ...(event.payload?.head ? { headSha: event.payload.head } : {}),
    ...(event.payload?.ref ? { gitRef: event.payload.ref } : {}),
    discoverySource: 'github-events',
  };
}

export async function loadKnownGitHubRepoIdentities(
  db: D1Database,
  repos: RepoIdentity[]
): Promise<Set<string>> {
  const unique = new Map<string, RepoIdentity>();
  for (const repo of repos) {
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (!unique.has(identity)) unique.set(identity, repo);
  }
  if (unique.size === 0) return new Set();

  const candidates = [...unique.values()];
  const known = new Set<string>();

  for (let offset = 0; offset < candidates.length; offset += D1_REPO_IDENTITY_CHUNK_SIZE) {
    const chunk = candidates.slice(offset, offset + D1_REPO_IDENTITY_CHUNK_SIZE);
    const valuesSql = chunk.map(() => '(?, ?)').join(', ');
    const bindings = chunk.flatMap((repo) => [repo.owner, repo.name]);
    const result = await db.prepare(`
      WITH candidate_repos(repo_owner, repo_name) AS (
        VALUES ${valuesSql}
      )
      SELECT c.repo_owner AS repoOwner, c.repo_name AS repoName
      FROM candidate_repos c
      WHERE EXISTS (
        SELECT 1
        FROM skill_sources AS s INDEXED BY skill_sources_repo_path_unique
        WHERE s.repo_owner = c.repo_owner
          AND s.repo_name = c.repo_name
        LIMIT 1
      ) OR EXISTS (
        SELECT 1
        FROM skills AS sk INDEXED BY skills_repo_path_unique
        WHERE sk.repo_owner = c.repo_owner
          AND sk.repo_name = c.repo_name
        LIMIT 1
      )
    `)
      .bind(...bindings)
      .all<{ repoOwner: string; repoName: string }>();

    for (const row of result.results || []) {
      known.add(`${row.repoOwner.toLowerCase()}/${row.repoName.toLowerCase()}`);
    }
  }

  return known;
}

/**
 * 获取上次处理的事件 ID
 */
async function getLastProcessedEventId(env: GithubEventsEnv): Promise<string | null> {
  return getGithubEventsStateStore(env).get('github-events:last-event-id');
}

/**
 * 保存最后处理的事件 ID
 */
async function setLastProcessedEventId(env: GithubEventsEnv, eventId: string): Promise<void> {
  await getGithubEventsStateStore(env).put('github-events:last-event-id', eventId, {
    expirationTtl: 86400 * 7,
  });
}

async function persistProcessedEventCursor(
  env: GithubEventsEnv,
  lastEventId: string | null,
  newestEventId: string | null
): Promise<void> {
  if (!newestEventId || newestEventId === lastEventId) {
    return;
  }

  await setLastProcessedEventId(env, newestEventId);
}

async function readEventReplayState(
  env: GithubEventsEnv,
  lastEventId: string | null
): Promise<Set<string>> {
  const store = getGithubEventsStateStore(env);
  const raw = await store.get(EVENT_REPLAY_STATE_KEY);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EventReplayStatePayload>;
    const baseLastEventId = parsed.baseLastEventId === null || typeof parsed.baseLastEventId === 'string'
      ? parsed.baseLastEventId
      : null;
    const processedPushEventIds = Array.isArray(parsed.processedPushEventIds)
      ? parsed.processedPushEventIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];

    if (baseLastEventId !== lastEventId || processedPushEventIds.length === 0) {
      await store.delete(EVENT_REPLAY_STATE_KEY);
      return new Set();
    }

    return new Set(processedPushEventIds);
  } catch {
    await store.delete(EVENT_REPLAY_STATE_KEY);
    return new Set();
  }
}

async function persistEventReplayState(
  env: GithubEventsEnv,
  lastEventId: string | null,
  processedPushEventIds: Set<string>
): Promise<void> {
  if (processedPushEventIds.size === 0) {
    return;
  }

  const payload: EventReplayStatePayload = {
    baseLastEventId: lastEventId,
    processedPushEventIds: [...processedPushEventIds],
  };

  await getGithubEventsStateStore(env).put(EVENT_REPLAY_STATE_KEY, JSON.stringify(payload), {
    expirationTtl: 24 * 60 * 60,
  });
}

async function clearEventReplayState(env: GithubEventsEnv): Promise<void> {
  await getGithubEventsStateStore(env).delete(EVENT_REPLAY_STATE_KEY);
}

async function readRepoQueueDedupeState(
  env: GithubEventsEnv,
  nowMs: number
): Promise<RepoQueueDedupeState> {
  const raw = await getGithubEventsStateStore(env).get(REPO_QUEUE_DEDUP_WINDOW_KEY);
  if (!raw) {
    return {
      recentUntilByIdentity: new Map(),
      queuedInRun: new Set(),
      dirty: false,
    };
  }

  try {
    const parsed = JSON.parse(raw) as RepoQueuedWindowPayload;
    const entries = isObject(parsed.entries) ? parsed.entries : {};
    const recentUntilByIdentity = new Map<string, number>();

    for (const [identity, expiresAtEpochMs] of Object.entries(entries)) {
      const expiresAt = Number(expiresAtEpochMs);
      if (!identity || !Number.isFinite(expiresAt) || expiresAt <= nowMs) {
        continue;
      }
      recentUntilByIdentity.set(identity, expiresAt);
    }

    return {
      recentUntilByIdentity,
      queuedInRun: new Set(),
      dirty: false,
    };
  } catch {
    return {
      recentUntilByIdentity: new Map(),
      queuedInRun: new Set(),
      dirty: true,
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wasRepoQueuedRecently(
  state: RepoQueueDedupeState,
  owner: string,
  name: string,
  skillPath: string | undefined,
  nowMs: number
): boolean {
  const identity = buildRepoQueuedDedupIdentity(owner, name, skillPath);
  if (state.queuedInRun.has(identity)) {
    return true;
  }

  const expiresAt = state.recentUntilByIdentity.get(identity);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt > nowMs) {
    return true;
  }

  state.recentUntilByIdentity.delete(identity);
  state.dirty = true;
  return false;
}

function markRepoQueued(
  state: RepoQueueDedupeState,
  owner: string,
  name: string,
  skillPath: string | undefined,
  nowMs: number,
  ttlSeconds: number
): void {
  const identity = buildRepoQueuedDedupIdentity(owner, name, skillPath);
  state.queuedInRun.add(identity);
  state.recentUntilByIdentity.set(identity, nowMs + ttlSeconds * 1000);
  state.dirty = true;
}

async function persistRepoQueueDedupeState(
  env: GithubEventsEnv,
  state: RepoQueueDedupeState,
  nowMs: number
): Promise<void> {
  if (!state.dirty) {
    return;
  }

  const ttlSeconds = getRepoQueueDedupTtlSeconds(env);
  const entries: Record<string, number> = {};
  for (const [identity, expiresAtEpochMs] of state.recentUntilByIdentity.entries()) {
    if (expiresAtEpochMs > nowMs) {
      entries[identity] = expiresAtEpochMs;
    }
  }

  await getGithubEventsStateStore(env).put(REPO_QUEUE_DEDUP_WINDOW_KEY, JSON.stringify({ entries }), {
    expirationTtl: ttlSeconds * 2,
  });
}

async function getCodeSearchHeadCursor(env: GithubEventsEnv): Promise<string | null> {
  return getGithubEventsStateStore(env).get(CODE_SEARCH_CURSOR_KEY);
}

async function setCodeSearchHeadCursor(env: GithubEventsEnv, fingerprint: string): Promise<void> {
  await getGithubEventsStateStore(env).put(CODE_SEARCH_CURSOR_KEY, fingerprint, {
    expirationTtl: 86400 * 30,
  });
}

async function readGitHubRateLimitBudget(
  env: GithubEventsEnv,
  bucket: 'rest' | 'search' | 'graphql',
  options: { maxAgeMs?: number; includeStale?: boolean } = {}
): Promise<GitHubRateLimitSnapshot | null> {
  const tokenIds = await resolveGitHubTokenIds(getGitHubTokenInputFromEnv(env));
  // The anonymous GitHub API pool is only 60 requests/hour and is shared by
  // Worker egress. Discovery must stop instead of silently falling back to it.
  if (tokenIds.length === 0) return null;

  return readAggregatedRateLimitSnapshot(bucket, {
    kv: getGitHubRateLimitKVFromEnv(env),
    tokenIds,
    maxAgeMs: options.maxAgeMs,
    includeStale: options.includeStale,
  });
}

async function readOrRefreshRateLimitSnapshot(
  env: GithubEventsEnv,
  bucket: 'rest' | 'search'
): Promise<GitHubRateLimitSnapshot | null> {
  let snapshot = await readGitHubRateLimitBudget(env, bucket, {
    maxAgeMs: RATE_LIMIT_SNAPSHOT_MAX_AGE_MS,
  });

  if (!isRateLimitSnapshotStale(snapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS)) {
    return snapshot;
  }

  try {
    const tokenCandidates = await resolveGitHubTokenCandidates(getGitHubTokenInputFromEnv(env));

    for (const candidate of tokenCandidates) {
      const response = await getRateLimit({
        token: candidate.value,
        userAgent: 'SkillsCat-Worker/1.0',
        rateLimitKV: getGitHubRateLimitKVFromEnv(env),
      });

      if (!response.ok) {
        console.warn(`Failed to refresh GitHub rate limit snapshot for token ${candidate.id}: ${response.status}`);
      }
    }
  } catch (error) {
    console.warn('Failed to refresh GitHub rate limit snapshot due to network error:', error);
  }

  snapshot = await readGitHubRateLimitBudget(env, bucket, {
    maxAgeMs: RATE_LIMIT_SNAPSHOT_MAX_AGE_MS,
  });
  return snapshot;
}

/**
 * 处理 GitHub Events
 */
async function processEvents(
  env: GithubEventsEnv,
  restSnapshot: GitHubRateLimitSnapshot | null,
  repoDedupeState: RepoQueueDedupeState,
  nowMs: number
): Promise<EventsDiscoveryResult> {
  let processed = 0;
  let queued = 0;
  let unknownSkipped = 0;
  let pagesFetched = 0;

  const config = getEventsDiscoveryConfig(env);

  if (!restSnapshot) {
    return {
      processed,
      queued,
      unknownSkipped,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'missing_rate_limit',
    };
  }

  if (restSnapshot.remaining < config.minRestRemaining) {
    return {
      processed,
      queued,
      unknownSkipped,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'insufficient_rest_remaining',
    };
  }

  const allowedPages = computeAllowedSearchPages(
    config.pages,
    restSnapshot.remaining,
    restSnapshot.resetAtEpochSec,
    config.cronIntervalSeconds,
    config.restReserve
  );

  if (allowedPages <= 0) {
    return {
      processed,
      queued,
      unknownSkipped,
      pagesFetched,
      allowedPages: 0,
      skippedReason: 'budget_exhausted',
    };
  }

  let lastEventId: string | null = null;
  let replayedPushEventIds = new Set<string>();
  let hadReplayState = false;

  try {
    lastEventId = await getLastProcessedEventId(env);
    replayedPushEventIds = await readEventReplayState(env, lastEventId);
    hadReplayState = replayedPushEventIds.size > 0;
    let newestEventId: string | null = null;
    let reachedLastProcessed = false;
    let deferredByQueueCap = false;

    for (let page = 1; page <= allowedPages; page++) {
      const fetchResult = await fetchGitHubEvents(env, page, config.perPage);
      if (fetchResult.rateLimited) {
        if (replayedPushEventIds.size > 0) {
          await persistEventReplayState(env, lastEventId, replayedPushEventIds);
        }
        return {
          processed,
          queued,
          unknownSkipped,
          pagesFetched,
          allowedPages,
          skippedReason: 'events_rate_limited',
        };
      }

      const events = fetchResult.events;
      pagesFetched++;

      if (events.length === 0) {
        break;
      }

      const sortedEvents = events.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      if (!newestEventId && sortedEvents.length > 0) {
        newestEventId = sortedEvents[0].id;
      }

      const pushCandidates: Array<{ event: GitHubEvent; message: IndexingMessage }> = [];

      for (const event of sortedEvents) {
        if (event.id === lastEventId) {
          reachedLastProcessed = true;
          break;
        }

        if (replayedPushEventIds.has(event.id)) {
          continue;
        }

        processed++;

        if (event.type !== 'PushEvent') {
          // Non-push events do not enqueue any work, so we can safely rely on the
          // last processed cursor without persisting per-event dedupe state.
          continue;
        }

        const message = extractRepoInfo(event);
        if (message) pushCandidates.push({ event, message });
      }

      let knownRepoIdentities: Set<string> | null = null;
      if (config.knownReposOnly && pushCandidates.length > 0) {
        try {
          knownRepoIdentities = await loadKnownGitHubRepoIdentities(
            env.DB,
            pushCandidates.map(({ message }) => ({
              owner: message.repoOwner,
              name: message.repoName,
            }))
          );
        } catch (error) {
          console.warn('Failed to load known GitHub repositories; preserving the event cursor for retry:', error);
          throw error;
        }
      }

      for (const { event, message } of pushCandidates) {
        const repoIdentity = `${message.repoOwner.toLowerCase()}/${message.repoName.toLowerCase()}`;
        if (knownRepoIdentities && !knownRepoIdentities.has(repoIdentity)) {
          unknownSkipped++;
          replayedPushEventIds.add(event.id);
          continue;
        }

        if (wasRepoQueuedRecently(repoDedupeState, message.repoOwner, message.repoName, undefined, nowMs)) {
          replayedPushEventIds.add(event.id);
          continue;
        }

        if (queued >= config.maxQueuedRepos) {
          deferredByQueueCap = true;
          break;
        }

        await env.INDEXING_QUEUE.send(message);
        markRepoQueued(repoDedupeState, message.repoOwner, message.repoName, undefined, nowMs, getEventQueueDedupTtlSeconds(env));
        queued++;
        console.log(`Queued known repo for indexing: ${message.repoOwner}/${message.repoName}`);
        replayedPushEventIds.add(event.id);
      }

      if (deferredByQueueCap) {
        break;
      }

      if (reachedLastProcessed || events.length < config.perPage) {
        break;
      }
    }

    if (deferredByQueueCap) {
      await persistEventReplayState(env, lastEventId, replayedPushEventIds);
      return {
        processed,
        queued,
        unknownSkipped,
        pagesFetched,
        allowedPages,
        skippedReason: 'queue_cap_reached',
      };
    }

    if (hadReplayState) {
      await clearEventReplayState(env);
    }
    await persistProcessedEventCursor(env, lastEventId, newestEventId);
  } catch (error) {
    try {
      if (replayedPushEventIds.size > 0) {
        await persistEventReplayState(env, lastEventId, replayedPushEventIds);
      }
    } catch (replayStateError) {
      console.error('Failed to persist GitHub event replay state:', replayStateError);
    }
    console.error('Error processing GitHub events:', error);
    throw error;
  }

  return {
    processed,
    queued,
    unknownSkipped,
    pagesFetched,
    allowedPages,
  };
}

/**
 * 处理一页 code search 结果:过滤 SKILL.md → run 内去重 → 窗口去重 → 入队。
 * previousHeadCursor 仅追头路径使用;回填传 null 不做游标截停。
 */
async function queueCodeSearchItems(
  env: GithubEventsEnv,
  items: GitHubCodeSearchItem[],
  repoDedupeState: RepoQueueDedupeState,
  seenFingerprints: Set<string>,
  previousHeadCursor: string | null,
  nowMs: number
): Promise<{ scanned: number; queued: number; stoppedByCursor: boolean }> {
  let scanned = 0;
  let queued = 0;
  let stoppedByCursor = false;
  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);

  for (const item of items) {
    scanned++;

    if (!isSkillMdPath(item.path)) {
      continue;
    }

    const fingerprint = buildSearchFingerprint(item);
    if (!fingerprint) {
      continue;
    }

    if (previousHeadCursor && fingerprint === previousHeadCursor) {
      stoppedByCursor = true;
      break;
    }

    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);

    const repo = parseRepoFullName(item.repository?.full_name);
    if (!repo) {
      continue;
    }

    const skillPath = getSkillPathFromSkillMdPath(item.path);
    if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, skillPath, nowMs)) {
      continue;
    }

    const message: IndexingMessage = {
      type: 'check_skill',
      repoOwner: repo.owner,
      repoName: repo.name,
      skillPath,
      skillFilePath: item.path,
      discoverySource: 'github-code-search',
      discoveryFingerprint: fingerprint,
    };

    await env.INDEXING_QUEUE.send(message);
    markRepoQueued(repoDedupeState, repo.owner, repo.name, skillPath, nowMs, dedupTtlSeconds);
    queued++;
  }

  return { scanned, queued, stoppedByCursor };
}

async function processCodeSearchDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  initialSearchSnapshot?: GitHubRateLimitSnapshot | null,
  nowMs: number = Date.now()
): Promise<SearchDiscoveryResult> {
  const config = getSearchDiscoveryConfig(env);
  const baseResult: SearchDiscoveryResult = {
    scanned: 0,
    queued: 0,
    pagesFetched: 0,
    allowedPages: 0,
    stoppedByCursor: false,
  };

  if (!config.enabled) {
    return {
      ...baseResult,
      skippedReason: 'disabled',
    };
  }

  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return {
      ...baseResult,
      skippedReason: 'interval_throttled',
    };
  }

  const searchSnapshot = (!initialSearchSnapshot || isRateLimitSnapshotStale(initialSearchSnapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS))
    ? await readOrRefreshRateLimitSnapshot(env, 'search')
    : initialSearchSnapshot;
  if (!searchSnapshot) {
    return {
      ...baseResult,
      skippedReason: 'missing_rate_limit',
    };
  }

  const snapshotResult = (result: SearchDiscoveryResult): SearchDiscoveryResult => ({
    ...result,
    remainingAfter: Math.max(0, searchSnapshot.remaining - result.pagesFetched),
    resetAtEpochSecAfter: searchSnapshot.resetAtEpochSec,
  });

  if (searchSnapshot.remaining < config.minRestRemaining) {
    return snapshotResult({
      ...baseResult,
      skippedReason: 'insufficient_rest_remaining',
    });
  }

  const allowedPages = computeAllowedSearchPages(
    config.pages,
    searchSnapshot.remaining,
    searchSnapshot.resetAtEpochSec,
    config.cronIntervalSeconds,
    config.restReserve
  );

  if (allowedPages <= 0) {
    return snapshotResult({
      ...baseResult,
      allowedPages,
      skippedReason: 'budget_exhausted',
    });
  }

  const previousHeadCursor = await getCodeSearchHeadCursor(env);
  const seenFingerprints = new Set<string>();
  let stoppedByCursor = false;
  let queued = 0;
  let scanned = 0;
  let pagesFetched = 0;
  let nextHeadCursor: string | null = null;

  for (let page = 1; page <= allowedPages; page++) {
    const response = await searchCode(config.query, {
      page,
      perPage: config.perPage,
      sort: 'indexed',
      order: 'desc',
      // Budget snapshots are refreshed explicitly via /rate_limit.
      // Keep discovery requests themselves write-free for KV cost control.
      ...getGitHubRequestAuthFromEnv(env, { rateLimitMode: 'read_only' }),
      userAgent: 'SkillsCat-Worker/1.0',
    });

    if (!response.ok) {
      if (isGitHubRateLimited(response)) {
        return snapshotResult({
          scanned,
          queued,
          pagesFetched,
          allowedPages,
          stoppedByCursor,
          skippedReason: 'search_rate_limited',
        });
      }
      throw new Error(`Failed to fetch GitHub code search: ${response.status}`);
    }

    const payload = await response.json() as GitHubCodeSearchResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];

    pagesFetched++;
    if (page === 1 && items.length > 0) {
      nextHeadCursor = buildSearchFingerprint(items[0]);
    }

    const outcome = await queueCodeSearchItems(
      env,
      items,
      repoDedupeState,
      seenFingerprints,
      previousHeadCursor,
      nowMs
    );
    scanned += outcome.scanned;
    queued += outcome.queued;
    if (outcome.stoppedByCursor) {
      stoppedByCursor = true;
    }

    if (stoppedByCursor) {
      break;
    }

    if (items.length < config.perPage) {
      break;
    }
  }

  if (nextHeadCursor && nextHeadCursor !== previousHeadCursor) {
    await setCodeSearchHeadCursor(env, nextHeadCursor);
  }

  return snapshotResult({
    scanned,
    queued,
    pagesFetched,
    allowedPages,
    stoppedByCursor,
  });
}

async function getCodeSearchBackfillCursor(env: GithubEventsEnv): Promise<string | null> {
  const raw = await getGithubEventsStateStore(env).get(CODE_SEARCH_BACKFILL_CURSOR_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { date?: unknown };
    return typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      ? parsed.date
      : null;
  } catch {
    return null;
  }
}

async function setCodeSearchBackfillCursor(env: GithubEventsEnv, date: string): Promise<void> {
  await getGithubEventsStateStore(env).put(CODE_SEARCH_BACKFILL_CURSOR_KEY, JSON.stringify({ date }), {
    expirationTtl: 86400 * 30,
  });
}

/**
 * Code Search 日期切片回填:每 tick 处理一个 `created:<date>..<date>` 切片,
 * 游标前进一天;到达今天后回卷到起始日期重扫,捕获漏网仓库。
 * 严格受 search 预算约束,快照不可用或余量不足时整体跳过。
 */
async function processCodeSearchBackfill(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  initialSearchSnapshot?: GitHubRateLimitSnapshot | null,
  nowMs: number = Date.now(),
  pageBudgetOverride?: number
): Promise<CodeSearchBackfillResult> {
  const config = getSearchBackfillConfig(env);
  const baseResult: CodeSearchBackfillResult = {
    scanned: 0,
    queued: 0,
    pagesFetched: 0,
    allowedPages: 0,
  };

  if (!config.enabled) {
    return { ...baseResult, skippedReason: 'disabled' };
  }

  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...baseResult, skippedReason: 'interval_throttled' };
  }

  const searchSnapshot = (!initialSearchSnapshot || isRateLimitSnapshotStale(initialSearchSnapshot, RATE_LIMIT_SNAPSHOT_MAX_AGE_MS))
    ? await readOrRefreshRateLimitSnapshot(env, 'search')
    : initialSearchSnapshot;
  if (!searchSnapshot) {
    return { ...baseResult, skippedReason: 'missing_rate_limit' };
  }

  if (searchSnapshot.remaining < config.minRemaining) {
    return { ...baseResult, skippedReason: 'insufficient_remaining' };
  }

  const computedAllowedPages = computeAllowedSearchPages(
    config.maxPages,
    searchSnapshot.remaining,
    searchSnapshot.resetAtEpochSec,
    config.cronIntervalSeconds,
    config.reserve,
    nowMs
  );
  const allowedPages = pageBudgetOverride === undefined
    ? computedAllowedPages
    : Math.min(computedAllowedPages, Math.max(0, Math.floor(pageBudgetOverride)));

  if (allowedPages <= 0) {
    return { ...baseResult, allowedPages, skippedReason: 'budget_exhausted' };
  }

  const today = formatDateOnly(nowMs);
  const cursor = await getCodeSearchBackfillCursor(env);
  const date = (!cursor || cursor >= today) ? config.startDate : cursor;
  const query = `filename:SKILL.md created:${date}..${date}`;

  const seenFingerprints = new Set<string>();
  let scanned = 0;
  let queued = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= allowedPages; page++) {
    const response = await searchCode(query, {
      page,
      perPage: config.perPage,
      sort: 'indexed',
      order: 'desc',
      // Budget snapshots are refreshed explicitly via /rate_limit.
      // Keep discovery requests themselves write-free for KV cost control.
      ...getGitHubRequestAuthFromEnv(env, { rateLimitMode: 'read_only' }),
      userAgent: 'SkillsCat-Worker/1.0',
    });

    if (!response.ok) {
      if (isGitHubRateLimited(response)) {
        return { scanned, queued, pagesFetched, allowedPages, date, skippedReason: 'search_rate_limited' };
      }
      console.warn(`Code search backfill failed for ${date}: ${response.status}`);
      return { scanned, queued, pagesFetched, allowedPages, date, skippedReason: 'search_failed' };
    }

    const payload = await response.json() as GitHubCodeSearchResponse;
    const items = Array.isArray(payload.items) ? payload.items : [];
    pagesFetched++;

    const outcome = await queueCodeSearchItems(
      env,
      items,
      repoDedupeState,
      seenFingerprints,
      null,
      nowMs
    );
    scanned += outcome.scanned;
    queued += outcome.queued;

    if (items.length < config.perPage) {
      break;
    }

    if (page === allowedPages) {
      // GitHub search 单查询上限 1000 条/10 页,单日 SKILL.md 新增量远达不到;
      // 截断只记日志,游标照常前进。
      console.log(`Code search backfill page budget exhausted on a full page for ${date}; remaining results are not fetched`);
    }
  }

  await setCodeSearchBackfillCursor(env, addDaysToDateOnly(date, 1));

  return { scanned, queued, pagesFetched, allowedPages, date };
}

/**
 * HTML 仓库搜索发现:抓 github.com/search 仓库结果页(零 API 配额),
 * 入队前用 github.com/<owner>/<repo>/raw/HEAD/SKILL.md 校验候选(200 才算通过),
 * 过滤 awesome-list 类仓库。任何抓取/解析失败只记日志跳过,绝不影响其他路径。
 */
async function processHtmlRepoSearchDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  ctx: ExecutionContext | null,
  lockToken: string,
  nowMs: number = Date.now()
): Promise<HtmlSearchDiscoveryResult> {
  const config = getHtmlSearchDiscoveryConfig(env);
  const baseResult: HtmlSearchDiscoveryResult = { scanned: 0, queued: 0, pagesFetched: 0 };

  if (!config.enabled) {
    return { ...baseResult, skippedReason: 'disabled' };
  }

  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...baseResult, skippedReason: 'interval_throttled' };
  }

  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);
  const waitUntil = ctx ? (promise: Promise<unknown>) => ctx.waitUntil(promise) : undefined;
  let scanned = 0;
  let queued = 0;
  let pagesFetched = 0;
  const seenRepos = new Set<string>();

  for (const query of config.queries) {
    for (let page = 1; page <= config.pages; page++) {
      if (!await renewDiscoveryRunLock(env, lockToken)) {
        return { scanned, queued, pagesFetched, skippedReason: 'lock_lost' };
      }

      let results;
      try {
        results = await fetchPublicSkillRepoSearchPage({ query, page, waitUntil });
        pagesFetched++;
      } catch (error) {
        console.warn(
          `HTML repo search discovery failed for query "${query}" page ${page}:`,
          error instanceof PublicRepoSearchError ? `${error.reason} (status=${error.status ?? 'none'})` : error
        );
        continue;
      }

      for (const repo of results) {
        scanned++;

        if (!await renewDiscoveryRunLock(env, lockToken)) {
          return { scanned, queued, pagesFetched, skippedReason: 'lock_lost' };
        }

        const repoIdentity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
        if (seenRepos.has(repoIdentity)) continue;
        seenRepos.add(repoIdentity);
        if (seenRepos.size > config.maxCandidates) {
          return { scanned, queued, pagesFetched, skippedReason: 'candidate_cap_reached' };
        }

        if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, undefined, nowMs)) {
          continue;
        }

        let hasSkillMd = false;
        try {
          hasSkillMd = await checkPublicSkillMdAtHead(repo.owner, repo.name, { waitUntil });
        } catch (error) {
          console.warn(`HTML repo search candidate check failed for ${repo.owner}/${repo.name}:`, error);
          continue;
        }
        if (!hasSkillMd) continue;

        if (!await renewDiscoveryRunLock(env, lockToken)) {
          return { scanned, queued, pagesFetched, skippedReason: 'lock_lost' };
        }

        const message: IndexingMessage = {
          type: 'check_skill',
          repoOwner: repo.owner,
          repoName: repo.name,
          skillPath: undefined,
          discoverySource: 'github-repo-search-html',
        };

        await env.INDEXING_QUEUE.send(message);
        markRepoQueued(repoDedupeState, repo.owner, repo.name, undefined, nowMs, dedupTtlSeconds);
        queued++;
        console.log(`Queued HTML-discovered repo for indexing: ${repo.owner}/${repo.name}`);
      }

      if (results.length === 0) break;
    }
  }

  return { scanned, queued, pagesFetched };
}

async function processXSearchDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  lockToken: string,
  nowMs: number = Date.now()
): Promise<XSearchDiscoveryResult> {
  const config = getXSearchDiscoveryConfig(env);
  const base = { scanned: 0, queued: 0, tweets: 0 };
  if (!config.enabled) {
    return {
      ...base,
      skippedReason: env.X_BEARER_TOKEN?.trim() ? 'disabled' : 'missing_bearer_token',
    };
  }
  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...base, skippedReason: 'interval_throttled' };
  }

  const store = getGithubEventsStateStore(env);
  const sinceId = await store.get(X_SEARCH_SINCE_ID_KEY);
  const tweets: XSearchTweet[] = [];
  let nextToken: string | undefined;
  let newestId: string | undefined;
  let partialFailure: string | undefined;

  do {
    if (!await reserveXSearchRequest(store, config.budget, nowMs)) {
      partialFailure = 'budget_exhausted';
      break;
    }
    const params = new URLSearchParams({
      query: config.query,
      max_results: String(config.maxResults),
      'tweet.fields': 'entities,created_at',
    });
    if (sinceId) params.set('since_id', sinceId);
    if (nextToken) params.set('next_token', nextToken);

    let response: Response;
    try {
      response = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
        headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      });
    } catch (error) {
      console.warn('X search request failed:', error);
      partialFailure = 'request_failed';
      break;
    }
    if (!response.ok) {
      console.warn(`X search request failed: ${response.status}`);
      partialFailure = response.status === 429 ? 'rate_limited' : 'request_failed';
      break;
    }

    let payload: XSearchResponse;
    try {
      payload = await response.json() as XSearchResponse;
    } catch {
      partialFailure = 'invalid_response';
      break;
    }
    if (!newestId) newestId = payload.meta?.newest_id;
    const pageTweets = Array.isArray(payload.data) ? payload.data : [];
    tweets.push(...pageTweets.slice(0, config.maxTweets - tweets.length));
    nextToken = payload.meta?.next_token;
    if (nextToken && !await renewDiscoveryRunLock(env, lockToken)) {
      partialFailure = 'lock_lost';
      break;
    }
  } while (nextToken && tweets.length < config.maxTweets);

  if (tweets.length === 0 && partialFailure) return { ...base, skippedReason: partialFailure };
  const candidates = new Map<string, RepoIdentity>();
  for (const tweet of tweets) {
    for (const repo of extractGitHubReposFromTweet(tweet)) {
      candidates.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, repo);
    }
  }
  let known = new Set<string>();
  if (candidates.size > 0) {
    try {
      known = await loadKnownGitHubRepoIdentities(env.DB, [...candidates.values()]);
    } catch (error) {
      console.warn('Failed to filter X search candidates against known repositories:', error);
      return { scanned: candidates.size, queued: 0, tweets: tweets.length, skippedReason: 'known_repo_lookup_failed' };
    }
  }
  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);
  let queued = 0;
  for (const tweet of tweets) {
    for (const repo of extractGitHubReposFromTweet(tweet)) {
      const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
      if (known.has(identity) || queued >= config.maxQueuedRepos) continue;
      if (!await renewDiscoveryRunLock(env, lockToken)) return { scanned: tweets.length, queued, tweets: tweets.length, skippedReason: 'lock_lost' };
      if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, undefined, nowMs)) continue;
      const message: IndexingMessage = {
        type: 'check_skill', repoOwner: repo.owner, repoName: repo.name,
        discoverySource: 'x-search', discoveryFingerprint: tweet.id ? `x:${tweet.id}` : undefined,
      };
      await env.INDEXING_QUEUE.send(message);
      markRepoQueued(repoDedupeState, repo.owner, repo.name, undefined, nowMs, dedupTtlSeconds);
      queued++;
    }
  }
  // Only advance the since_id cursor after every requested page succeeds.
  // Advancing it after a partial failure would permanently skip older tweets
  // that were present on pages we did not process.
  if (newestId && !partialFailure) {
    await store.put(X_SEARCH_SINCE_ID_KEY, newestId, { expirationTtl: 30 * 86400 });
  }
  return { scanned: candidates.size, queued, tweets: tweets.length, skippedReason: partialFailure };
}

/** 零配额发现渠道的匿名文本抓取约定:UA、超时、无凭据,任何失败由调用方降级处理。 */
async function fetchDiscoveryTextPage(url: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'SkillsCat/1.0' },
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GitHub Topics HTML 爬虫:抓 topics 页面前几页提取 owner/repo 链接(零 API 配额)。
 * 无状态,靠已知仓库过滤 + 去重窗口控制重复;抓取失败只记日志跳过。
 */
export async function processGithubTopicsDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  lockToken: string,
  nowMs: number = Date.now()
): Promise<GithubTopicsDiscoveryResult> {
  const config = getGithubTopicsDiscoveryConfig(env);
  const base = { scanned: 0, queued: 0, pagesFetched: 0 };
  if (!config.enabled) {
    return { ...base, skippedReason: 'disabled' };
  }
  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...base, skippedReason: 'interval_throttled' };
  }

  const candidates = new Map<string, RepoIdentity>();
  let scanned = 0;
  let pagesFetched = 0;

  for (const topic of config.topics) {
    for (let page = 1; page <= config.pagesPerTopic; page++) {
      if (!await renewDiscoveryRunLock(env, lockToken)) {
        return { scanned, queued: 0, pagesFetched, skippedReason: 'lock_lost' };
      }
      const url = `https://github.com/topics/${encodeURIComponent(topic)}?page=${page}`;
      let response: Response;
      try {
        response = await fetchDiscoveryTextPage(url, 'text/html');
      } catch (error) {
        console.warn(`GitHub topics discovery request failed for topic "${topic}" page ${page}:`, error);
        break;
      }
      if (!response.ok) {
        console.warn(`GitHub topics discovery failed for topic "${topic}" page ${page}: ${response.status}`);
        break;
      }
      let html: string;
      try {
        html = await response.text();
      } catch (error) {
        console.warn(`GitHub topics discovery could not read topic "${topic}" page ${page}:`, error);
        break;
      }
      pagesFetched++;
      for (const repo of extractReposFromGitHubTopicsHtml(html)) {
        scanned++;
        candidates.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, repo);
      }
    }
  }

  if (pagesFetched === 0) {
    return { scanned, queued: 0, pagesFetched, skippedReason: 'request_failed' };
  }

  let known = new Set<string>();
  if (candidates.size > 0) {
    try {
      known = await loadKnownGitHubRepoIdentities(env.DB, [...candidates.values()]);
    } catch (error) {
      console.warn('Failed to filter GitHub topics candidates against known repositories:', error);
      return { scanned, queued: 0, pagesFetched, skippedReason: 'known_repo_lookup_failed' };
    }
  }

  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);
  let queued = 0;
  for (const repo of candidates.values()) {
    if (queued >= config.maxQueuedRepos) break;
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (known.has(identity)) continue;
    if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, undefined, nowMs)) continue;
    const message: IndexingMessage = {
      type: 'check_skill',
      repoOwner: repo.owner,
      repoName: repo.name,
      discoverySource: 'github-topics',
    };
    await env.INDEXING_QUEUE.send(message);
    markRepoQueued(repoDedupeState, repo.owner, repo.name, undefined, nowMs, dedupTtlSeconds);
    queued++;
    console.log(`Queued topics-discovered repo for indexing: ${repo.owner}/${repo.name}`);
  }

  return { scanned, queued, pagesFetched };
}

/**
 * Awesome 列表解析:拉取配置的 raw markdown 列表并提取 github.com 仓库链接(零 API 配额)。
 * 无状态,靠去重窗口控制重复;单文件超 2MB 或抓取失败只记日志跳过。
 */
export async function processAwesomeListsDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  lockToken: string,
  nowMs: number = Date.now()
): Promise<AwesomeListsDiscoveryResult> {
  const config = getAwesomeListsDiscoveryConfig(env);
  const base = { scanned: 0, queued: 0, listsFetched: 0 };
  if (!config.enabled) {
    return { ...base, skippedReason: 'disabled' };
  }
  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...base, skippedReason: 'interval_throttled' };
  }

  const candidates = new Map<string, RepoIdentity>();
  let scanned = 0;
  let listsFetched = 0;

  for (const listUrl of config.urls) {
    if (!await renewDiscoveryRunLock(env, lockToken)) {
      return { scanned, queued: 0, listsFetched, skippedReason: 'lock_lost' };
    }
    let response: Response;
    try {
      response = await fetchDiscoveryTextPage(listUrl, 'text/plain');
    } catch (error) {
      console.warn(`Awesome list discovery request failed for ${listUrl}:`, error);
      continue;
    }
    if (!response.ok) {
      console.warn(`Awesome list discovery failed for ${listUrl}: ${response.status}`);
      continue;
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      console.warn(`Awesome list discovery could not read ${listUrl}:`, error);
      continue;
    }
    listsFetched++;
    if (text.length > AWESOME_LIST_MAX_BYTES) {
      console.warn(`Awesome list skipped for exceeding ${AWESOME_LIST_MAX_BYTES} bytes: ${listUrl}`);
      continue;
    }
    for (const repo of extractGitHubReposFromText(text)) {
      scanned++;
      candidates.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, repo);
    }
  }

  if (listsFetched === 0) {
    return { scanned, queued: 0, listsFetched, skippedReason: 'request_failed' };
  }

  let known = new Set<string>();
  if (candidates.size > 0) {
    try {
      known = await loadKnownGitHubRepoIdentities(env.DB, [...candidates.values()]);
    } catch (error) {
      console.warn('Failed to filter awesome list candidates against known repositories:', error);
      return { scanned, queued: 0, listsFetched, skippedReason: 'known_repo_lookup_failed' };
    }
  }

  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);
  let queued = 0;
  for (const repo of candidates.values()) {
    if (queued >= config.maxQueuedRepos) break;
    const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    if (known.has(identity)) continue;
    if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, undefined, nowMs)) continue;
    const message: IndexingMessage = {
      type: 'check_skill',
      repoOwner: repo.owner,
      repoName: repo.name,
      discoverySource: 'awesome-lists',
    };
    await env.INDEXING_QUEUE.send(message);
    markRepoQueued(repoDedupeState, repo.owner, repo.name, undefined, nowMs, dedupTtlSeconds);
    queued++;
    console.log(`Queued awesome-list-discovered repo for indexing: ${repo.owner}/${repo.name}`);
  }

  return { scanned, queued, listsFetched };
}

/**
 * Bluesky 搜索发现:无鉴权调用 app.bsky.feed.searchPosts(非官方容忍行为,随时可能 403),
 * 从帖子文本与 link facets 提取 GitHub 仓库。since 游标只在完全成功后推进。
 */
export async function processBskySearchDiscovery(
  env: GithubEventsEnv,
  repoDedupeState: RepoQueueDedupeState,
  lockToken: string,
  nowMs: number = Date.now()
): Promise<BskySearchDiscoveryResult> {
  const config = getBskySearchDiscoveryConfig(env);
  const base = { scanned: 0, queued: 0, posts: 0 };
  if (!config.enabled) {
    return { ...base, skippedReason: 'disabled' };
  }
  if (!shouldRunSearchDiscoveryThisTick(nowMs, config.cronIntervalSeconds, config.intervalSeconds)) {
    return { ...base, skippedReason: 'interval_throttled' };
  }

  const store = getGithubEventsStateStore(env);
  const since = await store.get(BSKY_SEARCH_SINCE_KEY);
  const params = new URLSearchParams({
    q: config.query,
    sort: 'latest',
    limit: String(config.maxResults),
  });
  if (since) params.set('since', since);

  let response: Response;
  try {
    response = await fetch(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'SkillsCat/1.0' },
    });
  } catch (error) {
    console.warn('Bluesky search request failed:', error);
    return { ...base, skippedReason: 'request_failed' };
  }
  if (!response.ok) {
    console.warn(`Bluesky search request failed: ${response.status}`);
    if (response.status === 401 || response.status === 403) {
      return { ...base, skippedReason: 'auth_required' };
    }
    return { ...base, skippedReason: response.status === 429 ? 'rate_limited' : 'request_failed' };
  }

  let payload: BskySearchResponse;
  try {
    payload = await response.json() as BskySearchResponse;
  } catch {
    return { ...base, skippedReason: 'invalid_response' };
  }

  const posts = Array.isArray(payload.posts) ? payload.posts : [];
  const candidates = new Map<string, RepoIdentity>();
  for (const post of posts) {
    for (const repo of extractGitHubReposFromBskyPost(post)) {
      candidates.set(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, repo);
    }
  }

  let known = new Set<string>();
  if (candidates.size > 0) {
    try {
      known = await loadKnownGitHubRepoIdentities(env.DB, [...candidates.values()]);
    } catch (error) {
      console.warn('Failed to filter Bluesky search candidates against known repositories:', error);
      return { scanned: candidates.size, queued: 0, posts: posts.length, skippedReason: 'known_repo_lookup_failed' };
    }
  }

  const dedupTtlSeconds = getRepoQueueDedupTtlSeconds(env);
  let queued = 0;
  for (const post of posts) {
    for (const repo of extractGitHubReposFromBskyPost(post)) {
      const identity = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
      if (known.has(identity) || queued >= config.maxQueuedRepos) continue;
      if (!await renewDiscoveryRunLock(env, lockToken)) {
        return { scanned: candidates.size, queued, posts: posts.length, skippedReason: 'lock_lost' };
      }
      if (wasRepoQueuedRecently(repoDedupeState, repo.owner, repo.name, undefined, nowMs)) continue;
      const message: IndexingMessage = {
        type: 'check_skill', repoOwner: repo.owner, repoName: repo.name,
        discoverySource: 'bluesky-search',
        discoveryFingerprint: post.uri ? `bsky:${post.uri}` : undefined,
      };
      await env.INDEXING_QUEUE.send(message);
      markRepoQueued(repoDedupeState, repo.owner, repo.name, undefined, nowMs, dedupTtlSeconds);
      queued++;
    }
  }

  // Only advance the since cursor after a fully successful run.
  // Advancing it after a partial failure would permanently skip older posts.
  await store.put(BSKY_SEARCH_SINCE_KEY, new Date(nowMs).toISOString(), { expirationTtl: 30 * 86400 });
  return { scanned: candidates.size, queued, posts: posts.length };
}

function parseDiscoveryRunLockPayload(
  raw: string | null,
  ttlSeconds: number
): DiscoveryRunLockPayload | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DiscoveryRunLockPayload>;
    const token = typeof parsed.token === 'string' ? parsed.token : null;
    const acquiredAtEpochMs = Number(parsed.acquiredAtEpochMs);
    const expiresAtEpochMs = Number(parsed.expiresAtEpochMs);

    if (
      token
      && Number.isFinite(acquiredAtEpochMs)
      && Number.isFinite(expiresAtEpochMs)
    ) {
      return { token, acquiredAtEpochMs, expiresAtEpochMs };
    }
  } catch {
    const legacyAcquiredAtEpochMs = Number(raw);
    if (Number.isFinite(legacyAcquiredAtEpochMs) && legacyAcquiredAtEpochMs > 0) {
      return {
        token: 'legacy',
        acquiredAtEpochMs: legacyAcquiredAtEpochMs,
        expiresAtEpochMs: legacyAcquiredAtEpochMs + ttlSeconds * 1000,
      };
    }
  }

  return null;
}

async function readDiscoveryRunLock(env: GithubEventsEnv): Promise<DiscoveryRunLockPayload | null> {
  const ttlSeconds = getDiscoveryLockTtlSeconds(env);
  const raw = await getGithubEventsStateStore(env).get(RUN_LOCK_KEY);
  return parseDiscoveryRunLockPayload(raw, ttlSeconds);
}

async function acquireDiscoveryRunLock(env: GithubEventsEnv): Promise<string | null> {
  const existing = await readDiscoveryRunLock(env);
  if (existing && existing.expiresAtEpochMs > Date.now()) {
    return null;
  }

  const ttlSeconds = getDiscoveryLockTtlSeconds(env);
  const acquiredAtEpochMs = Date.now();
  const token = crypto.randomUUID();
  const payload: DiscoveryRunLockPayload = {
    token,
    acquiredAtEpochMs,
    expiresAtEpochMs: acquiredAtEpochMs + ttlSeconds * 1000,
  };

  await getGithubEventsStateStore(env).put(RUN_LOCK_KEY, JSON.stringify(payload), {
    expirationTtl: ttlSeconds,
  });

  const confirmed = await readDiscoveryRunLock(env);
  if (!confirmed || confirmed.token !== token) {
    return null;
  }

  return token;
}

async function hasDiscoveryRunLockOwnership(env: GithubEventsEnv, token: string): Promise<boolean> {
  const current = await readDiscoveryRunLock(env);
  if (!current) return false;
  if (current.token !== token) return false;
  return current.expiresAtEpochMs > Date.now();
}

async function renewDiscoveryRunLock(env: GithubEventsEnv, token: string): Promise<boolean> {
  const current = await readDiscoveryRunLock(env);
  if (!current || current.token !== token || current.expiresAtEpochMs <= Date.now()) {
    return false;
  }

  const ttlSeconds = getDiscoveryLockTtlSeconds(env);
  const now = Date.now();
  if (current.expiresAtEpochMs - now > (ttlSeconds * 1000) / 2) {
    return true;
  }

  const payload: DiscoveryRunLockPayload = {
    token,
    acquiredAtEpochMs: current.acquiredAtEpochMs,
    expiresAtEpochMs: now + ttlSeconds * 1000,
  };
  await getGithubEventsStateStore(env).put(RUN_LOCK_KEY, JSON.stringify(payload), {
    expirationTtl: ttlSeconds,
  });
  const confirmed = await readDiscoveryRunLock(env);
  return Boolean(confirmed && confirmed.token === token && confirmed.expiresAtEpochMs > Date.now());
}

async function releaseDiscoveryRunLock(env: GithubEventsEnv, token: string): Promise<void> {
  const current = await readDiscoveryRunLock(env);
  if (!current || current.token !== token) {
    return;
  }
  await getGithubEventsStateStore(env).delete(RUN_LOCK_KEY);
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: GithubEventsEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    const sharedRateLimitKV = getGitHubRateLimitKVFromEnv(env);
    const runtimeEnv = withGitHubRateLimitKVOverride(
      env,
      isDurableObjectKvStore(sharedRateLimitKV)
        ? createMemoizedDurableObjectKvStore(sharedRateLimitKV)
        : sharedRateLimitKV
    );
    const lockToken = await acquireDiscoveryRunLock(runtimeEnv);
    if (!lockToken) {
      console.log('GitHub Events Worker skipped due to active discovery lock');
      return;
    }

    console.log('GitHub Events Worker triggered at:', new Date().toISOString());

    let repoDedupeState: RepoQueueDedupeState | null = null;
    let nowMs = Date.now();

    try {
      repoDedupeState = await readRepoQueueDedupeState(runtimeEnv, nowMs);

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before discovery start');
        return;
      }

      const restBeforeEvents = await readOrRefreshRateLimitSnapshot(runtimeEnv, 'rest');

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before events processing');
        return;
      }

      const eventsResult = await processEvents(runtimeEnv, restBeforeEvents, repoDedupeState, nowMs);
      const searchBeforeDiscovery = await readGitHubRateLimitBudget(runtimeEnv, 'search', {
        includeStale: true,
      });

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before code search processing');
        return;
      }

      nowMs = Date.now();
      const searchResult = await processCodeSearchDiscovery(runtimeEnv, repoDedupeState, searchBeforeDiscovery, nowMs);

      nowMs = Date.now();
      const backfillSnapshot = searchBeforeDiscovery && searchResult.remainingAfter !== undefined
        ? {
            ...searchBeforeDiscovery,
            remaining: searchResult.remainingAfter,
            // This is a local per-tick budget after subtracting requests made
            // above, so do not refresh it back to the original snapshot.
            updatedAtEpochMs: Date.now(),
            ...(searchResult.resetAtEpochSecAfter === undefined
              ? {}
              : { resetAtEpochSec: searchResult.resetAtEpochSecAfter }),
          }
        : searchBeforeDiscovery;
      const backfillPageBudget = searchResult.skippedReason === 'search_rate_limited'
        ? 0
        : searchResult.skippedReason === 'disabled'
          || searchResult.skippedReason === 'interval_throttled'
          || searchResult.skippedReason === 'missing_rate_limit'
          ? undefined
          : Math.max(0, searchResult.allowedPages - searchResult.pagesFetched);
      const backfillResult = await processCodeSearchBackfill(
        runtimeEnv,
        repoDedupeState,
        backfillSnapshot,
        nowMs,
        backfillPageBudget
      );

      if (!await hasDiscoveryRunLockOwnership(runtimeEnv, lockToken)) {
        console.log('GitHub Events Worker lock ownership lost before HTML repo search processing');
        return;
      }

      nowMs = Date.now();
      const htmlResult = await processHtmlRepoSearchDiscovery(runtimeEnv, repoDedupeState, _ctx, lockToken, nowMs);
      nowMs = Date.now();
      const xResult = await processXSearchDiscovery(runtimeEnv, repoDedupeState, lockToken, nowMs);
      nowMs = Date.now();
      const topicsResult = await processGithubTopicsDiscovery(runtimeEnv, repoDedupeState, lockToken, nowMs);
      nowMs = Date.now();
      const awesomeResult = await processAwesomeListsDiscovery(runtimeEnv, repoDedupeState, lockToken, nowMs);
      nowMs = Date.now();
      const bskyResult = await processBskySearchDiscovery(runtimeEnv, repoDedupeState, lockToken, nowMs);
      console.log(
        `Discovery summary: events_processed=${eventsResult.processed}, events_queued=${eventsResult.queued}, events_unknown_skipped=${eventsResult.unknownSkipped}, events_pages=${eventsResult.pagesFetched}/${eventsResult.allowedPages}, events_skipped=${eventsResult.skippedReason || 'none'}, search_scanned=${searchResult.scanned}, search_queued=${searchResult.queued}, search_pages=${searchResult.pagesFetched}/${searchResult.allowedPages}, search_cursor_stop=${searchResult.stoppedByCursor}, search_skipped=${searchResult.skippedReason || 'none'}, backfill_scanned=${backfillResult.scanned}, backfill_queued=${backfillResult.queued}, backfill_pages=${backfillResult.pagesFetched}/${backfillResult.allowedPages}, backfill_date=${backfillResult.date || 'none'}, backfill_skipped=${backfillResult.skippedReason || 'none'}, html_scanned=${htmlResult.scanned}, html_queued=${htmlResult.queued}, html_pages=${htmlResult.pagesFetched}, html_skipped=${htmlResult.skippedReason || 'none'}, x_scanned=${xResult.scanned}, x_queued=${xResult.queued}, x_tweets=${xResult.tweets}, x_skipped=${xResult.skippedReason || 'none'}, topics_scanned=${topicsResult.scanned}, topics_queued=${topicsResult.queued}, topics_skipped=${topicsResult.skippedReason || 'none'}, awesome_scanned=${awesomeResult.scanned}, awesome_queued=${awesomeResult.queued}, awesome_skipped=${awesomeResult.skippedReason || 'none'}, bsky_scanned=${bskyResult.scanned}, bsky_queued=${bskyResult.queued}, bsky_posts=${bskyResult.posts}, bsky_skipped=${bskyResult.skippedReason || 'none'}, rest_snapshot_remaining=${restBeforeEvents?.remaining ?? 'unknown'}, search_snapshot_remaining=${searchBeforeDiscovery?.remaining ?? 'unknown'}`
      );
    } finally {
      if (repoDedupeState) {
        await persistRepoQueueDedupeState(runtimeEnv, repoDedupeState, Date.now());
      }
      await releaseDiscoveryRunLock(runtimeEnv, lockToken);
    }
  },
};
