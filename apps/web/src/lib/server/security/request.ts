import type { RequestEvent } from '@sveltejs/kit';
import {
  RATE_LIMITS,
  checkRateLimit,
  getRateLimitKey,
  rateLimitHeaders,
  type AdaptiveRateLimitOptions,
} from '$lib/server/security/ratelimit';
import { validateApiToken } from '$lib/server/auth/api';

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  prefix: string;
}

const DEFAULT_API_READ_LIMIT: RateLimitConfig = {
  limit: 300,
  windowSeconds: 60,
  prefix: 'rl:api:read',
};

const DEFAULT_API_WRITE_LIMIT: RateLimitConfig = {
  limit: 90,
  windowSeconds: 60,
  prefix: 'rl:api:write',
};

const AUTH_FLOW_LIMIT: RateLimitConfig = {
  limit: 30,
  windowSeconds: 60,
  prefix: 'rl:api:auth',
};

const TRANSFER_LIMIT: RateLimitConfig = {
  limit: 80,
  windowSeconds: 60,
  prefix: 'rl:api:transfer',
};

const HEAVY_TRANSFER_LIMIT: RateLimitConfig = {
  limit: 30,
  windowSeconds: 60,
  prefix: 'rl:api:transfer:heavy',
};

const UPLOAD_LIMIT: RateLimitConfig = {
  limit: 40,
  windowSeconds: 3600,
  prefix: 'rl:api:upload',
};

const AUTH_ROUTE_IDS = new Set([
  '/api/device/authorize',
  '/api/device/code',
  '/api/device/token',
  '/api/device/refresh',
  '/registry/auth/authorize',
  '/registry/auth/init',
  '/registry/auth/token',
]);

const CSRF_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/device\/(authorize|code|token|refresh)$/,
  /^\/registry\/auth\/(authorize|init|token)$/,
  /^\/api\/admin\/(archive|resurrection)$/,
  /^\/api\/skills\/[^/]+\/track-install$/,
];

const UA_PROTECTED_ROUTE_IDS = new Set([
  '/mcp',
  '/api/skills/upload',
  '/api/skills/[slug]',
  '/api/skills/[owner]/[...name]',
  '/api/skills/[slug]/download',
  '/api/skills/[slug]/files',
  '/api/skills/[slug]/file',
  '/api/skills/[slug]/track-install',
  '/api/tools/search-skills',
  '/api/tools/resolve-repo-skills',
  '/api/tools/get-skill-files',
  '/registry/skill/[owner]/[...name]',
  '/registry/search/tool',
]);

const CACHEABLE_SEARCH_ROUTE_IDS = new Set([
  '/api/search',
  '/registry/search',
  '/registry/search/tool',
  '/api/tools/search-skills',
  '/openclaw/api/v1/search',
]);

const CACHEABLE_REPO_ROUTE_IDS = new Set([
  '/registry/repo/[owner]/[repo]',
  '/api/tools/resolve-repo-skills',
]);

const CACHEABLE_DETAIL_ROUTE_IDS = new Set([
  '/api/skills/[slug]',
  '/api/skills/[owner]/[...name]',
  '/registry/skill/[owner]/[...name]',
]);

const CACHEABLE_BUNDLE_ROUTE_IDS = new Set([
  '/api/skills/[slug]/files',
  '/api/tools/get-skill-files',
]);

const BLOCKED_AUTOMATION_UA = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bpython-requests\b/i,
  /\baiohttp\b/i,
  /\bhttpclient\b/i,
  /\bgo-http-client\b/i,
  /\bpostmanruntime\b/i,
  /\binsomnia\b/i,
  /\bokhttp\b/i,
  /\blibwww-perl\b/i,
  /\bjava\/\d/i,
  /\bscrapy\b/i,
];

const BROWSER_OR_APP_UA = [
  /mozilla\/\d/i,
  /\bchrome\/\d/i,
  /\bsafari\/\d/i,
  /\bfirefox\/\d/i,
  /\bedg\/\d/i,
  /\bopenclaw(?:\/|\b)/i,
  /\bskillscat-cli\/\d/i,
  /\bskillscat\/\d/i,
];

const ALLOWED_CRAWLER_UA = [
  /\bgooglebot\b/i,
  /\bgoogle-inspectiontool\b/i,
  /\bbingbot\b/i,
  /\bduckduckbot\b/i,
  /\bapplebot\b/i,
  /\bccbot\b/i,
  /\bbaiduspider\b/i,
  /\byandexbot\b/i,
  /\bslurp\b/i,
  /\bgptbot\b/i,
  /\bchatgpt-user\b/i,
  /\boai-searchbot\b/i,
  /\bperplexitybot\b/i,
  /\bclaudebot\b/i,
  /\banthropic-ai\b/i,
  /\bbytespider\b/i,
  /\bmeta-externalagent\b/i,
  /\bfacebookexternalhit\b/i,
];

function isApiOrRegistryPath(pathname: string): boolean {
  if (pathname === '/mcp') {
    return true;
  }

  if (pathname === '/openclaw/api/v1/search') {
    return true;
  }

  if (pathname === '/openclaw/api/v1/skills') {
    return true;
  }

  // Keep the ClawHub/OpenClaw compatibility surface outside this gate.
  // Those routes have their own auth semantics and client mix (OpenClaw, clawhub CLI),
  // and must not inherit the stricter native registry/tool UA policy by accident.
  if (
    pathname.startsWith('/openclaw/api/') ||
    pathname === '/api/v1' ||
    pathname.startsWith('/api/v1/')
  ) {
    return false;
  }

  if (pathname.startsWith('/api/')) {
    return true;
  }

  if (pathname.startsWith('/registry/skill/')) {
    return true;
  }

  if (pathname.startsWith('/registry/repo/')) {
    return true;
  }

  if (pathname.startsWith('/registry/search')) {
    return true;
  }

  return (
    pathname === '/registry/auth/init' ||
    pathname === '/registry/auth/token' ||
    pathname === '/registry/auth/authorize'
  );
}

function normalizeUserAgent(raw: string | null): string {
  return (raw || '').trim();
}

function routeNeedsUaProtection(routeId: string | null, pathname: string): boolean {
  if (routeId && UA_PROTECTED_ROUTE_IDS.has(routeId)) {
    return true;
  }

  return (
    pathname === '/mcp' ||
    /^\/api\/skills\/.+\/(download|files|file|track-install)$/.test(pathname) ||
    /^\/api\/tools\/(search-skills|resolve-repo-skills|get-skill-files)$/.test(pathname) ||
    pathname === '/api/skills/upload' ||
    /^\/registry\/skill\//.test(pathname) ||
    /^\/registry\/repo\//.test(pathname) ||
    pathname === '/registry/search/tool'
  );
}

function isCorsProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/registry/') || pathname.startsWith('/api/tools/');
}

function isMcpPath(pathname: string): boolean {
  return pathname === '/mcp';
}

function isAllowedCrawler(ua: string): boolean {
  return ALLOWED_CRAWLER_UA.some((pattern) => pattern.test(ua));
}

function isBrowserOrTrustedClient(ua: string): boolean {
  return BROWSER_OR_APP_UA.some((pattern) => pattern.test(ua));
}

function isBlockedAutomation(ua: string): boolean {
  return BLOCKED_AUTOMATION_UA.some((pattern) => pattern.test(ua));
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token ? token : null;
}

function hasTokenAuthHeader(request: Request): boolean {
  return getBearerToken(request) !== null;
}

function isSkillscatCliUserAgent(ua: string): boolean {
  return /\bskillscat-cli\/\d/i.test(ua);
}

function hasAnonymousBackgroundSubmitMarker(request: Request): boolean {
  return request.headers.get('x-skillscat-background-submit') === '1';
}

function isAnonymousCliBackgroundSubmitRequest(request: Request): boolean {
  if (hasTokenAuthHeader(request)) return false;
  if (!hasAnonymousBackgroundSubmitMarker(request)) return false;
  const ua = normalizeUserAgent(request.headers.get('user-agent'));
  return isSkillscatCliUserAgent(ua);
}

function isMutationMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function isCsrfExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PATHS.some((pattern) => pattern.test(pathname));
}

function hasSessionCookie(request: Request): boolean {
  const cookie = request.headers.get('cookie') || '';
  return /(better-auth|session|auth\.session|session_token)/i.test(cookie);
}

function getRequestSourceOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    return origin;
  }

  const referer = request.headers.get('referer');
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function getCurrentRequestOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function isCacheableSearchRequest(
  routeId: string | null,
  pathname: string,
  method: string,
  url: URL
): boolean {
  if (!['GET', 'HEAD'].includes(method)) {
    return false;
  }

  if (pathname === '/api/search' || routeId === '/api/search') {
    return true;
  }

  const matchesSearchRoute = (routeId && CACHEABLE_SEARCH_ROUTE_IDS.has(routeId)) ||
    pathname === '/registry/search' ||
    pathname === '/registry/search/tool' ||
    pathname === '/api/tools/search-skills' ||
    pathname === '/openclaw/api/v1/search';

  if (!matchesSearchRoute) {
    return false;
  }

  return !parseBooleanQuery(url.searchParams.get('include_private')) &&
    !parseBooleanQuery(url.searchParams.get('includePrivate'));
}

function isCacheableRepoRequest(
  routeId: string | null,
  pathname: string,
  method: string,
  tokenAuth: boolean,
  sessionCookie: boolean
): boolean {
  if (!['GET', 'HEAD'].includes(method)) {
    return false;
  }

  const matchesRepoRoute = (routeId && CACHEABLE_REPO_ROUTE_IDS.has(routeId)) ||
    /^\/registry\/repo\//.test(pathname) ||
    pathname === '/api/tools/resolve-repo-skills';

  if (!matchesRepoRoute) {
    return false;
  }

  return !tokenAuth && !sessionCookie;
}

function isCacheableDetailRequest(
  routeId: string | null,
  pathname: string,
  method: string,
  tokenAuth: boolean,
  sessionCookie: boolean
): boolean {
  if (!['GET', 'HEAD'].includes(method)) {
    return false;
  }

  const matchesDetailRoute = (routeId && CACHEABLE_DETAIL_ROUTE_IDS.has(routeId)) ||
    /^\/registry\/skill\//.test(pathname);

  if (!matchesDetailRoute) {
    return false;
  }

  return !tokenAuth && !sessionCookie;
}

function isCacheableBundleRequest(
  routeId: string | null,
  pathname: string,
  method: string,
  tokenAuth: boolean,
  sessionCookie: boolean
): boolean {
  if (!['GET', 'HEAD'].includes(method)) {
    return false;
  }

  const matchesBundleRoute = (routeId && CACHEABLE_BUNDLE_ROUTE_IDS.has(routeId)) ||
    /^\/api\/skills\/.+\/files$/.test(pathname) ||
    pathname === '/api/tools/get-skill-files';

  if (!matchesBundleRoute) {
    return false;
  }

  return !tokenAuth && !sessionCookie;
}

function isCacheableBrowseRequest(routeId: string | null, pathname: string, method: string): boolean {
  if (!['GET', 'HEAD'].includes(method)) {
    return false;
  }

  return routeId === '/openclaw/api/v1/skills' || pathname === '/openclaw/api/v1/skills';
}

function getAdaptiveRateLimitOptions(env: App.Platform['env'] | undefined): AdaptiveRateLimitOptions {
  return {
    burstViolationWindowSeconds: parseOptionalPositiveInt(env?.RATE_LIMIT_BURST_WINDOW_SECONDS),
    burstViolationThreshold: parseOptionalPositiveInt(env?.RATE_LIMIT_BURST_THRESHOLD),
    maxPenaltyLevel: parseOptionalPositiveInt(env?.RATE_LIMIT_MAX_PENALTY_LEVEL),
    penaltyTtlLevel1Seconds: parseOptionalPositiveInt(env?.RATE_LIMIT_PENALTY_TTL_LEVEL_1_SECONDS),
    penaltyTtlLevel2Seconds: parseOptionalPositiveInt(env?.RATE_LIMIT_PENALTY_TTL_LEVEL_2_SECONDS),
    penaltyTtlLevel3Seconds: parseOptionalPositiveInt(env?.RATE_LIMIT_PENALTY_TTL_LEVEL_3_SECONDS),
  };
}

function isSubmitRoute(routeId: string | null, pathname: string): boolean {
  return routeId === '/api/submit' || pathname === '/api/submit';
}

function pickRateLimitConfig(
  routeId: string | null,
  pathname: string,
  url: URL,
  method: string,
  tokenAuth: boolean,
  anonymousCliBackgroundSubmit: boolean,
  sessionCookie: boolean
): RateLimitConfig {
  if (isCacheableSearchRequest(routeId, pathname, method, url)) {
    if (routeId === '/api/search' || pathname === '/api/search') {
      return RATE_LIMITS.autocomplete;
    }
    return RATE_LIMITS.search;
  }

  if (isCacheableBrowseRequest(routeId, pathname, method)) {
    return RATE_LIMITS.browse;
  }

  if (isCacheableDetailRequest(routeId, pathname, method, tokenAuth, sessionCookie)) {
    return RATE_LIMITS.detail;
  }

  if (isCacheableBundleRequest(routeId, pathname, method, tokenAuth, sessionCookie)) {
    return RATE_LIMITS.bundle;
  }

  if (isCacheableRepoRequest(routeId, pathname, method, tokenAuth, sessionCookie)) {
    return RATE_LIMITS.repo;
  }

  if (isSubmitRoute(routeId, pathname)) {
    if (anonymousCliBackgroundSubmit) {
      return RATE_LIMITS.submitAnonymousCli;
    }
    return tokenAuth ? RATE_LIMITS.submitToken : RATE_LIMITS.submit;
  }

  if (routeId === '/api/skills/upload' || pathname === '/api/skills/upload') {
    return UPLOAD_LIMIT;
  }

  if (routeId && AUTH_ROUTE_IDS.has(routeId)) {
    return AUTH_FLOW_LIMIT;
  }

  if (
    routeId === '/mcp' ||
    pathname === '/mcp' ||
    routeId === '/api/skills/[slug]' ||
    routeId === '/api/skills/[owner]/[...name]' ||
    routeId === '/api/skills/[slug]/files' ||
    routeId === '/api/skills/[slug]/download' ||
    routeId === '/api/tools/get-skill-files' ||
    routeId === '/registry/skill/[owner]/[...name]'
  ) {
    return HEAVY_TRANSFER_LIMIT;
  }

  if (routeNeedsUaProtection(routeId, pathname)) {
    return TRANSFER_LIMIT;
  }

  return method === 'GET' || method === 'HEAD'
    ? DEFAULT_API_READ_LIMIT
    : DEFAULT_API_WRITE_LIMIT;
}

async function resolveRateLimitClientKey(
  request: Request,
  db: D1Database | undefined
): Promise<string> {
  const token = getBearerToken(request);
  if (!token || !db) {
    return `ip:${getRateLimitKey(request)}`;
  }

  const tokenInfo = await validateApiToken(token, db, { updateLastUsedAt: false });
  if (!tokenInfo) {
    return `ip:${getRateLimitKey(request)}`;
  }

  if (tokenInfo.userId) {
    return `user:${tokenInfo.userId}`;
  }

  if (tokenInfo.orgId) {
    return `org:${tokenInfo.orgId}`;
  }

  return `token:${tokenInfo.id}`;
}

function securityJsonResponse(
  status: number,
  body: Record<string, string>,
  headers: Record<string, string> = {},
  cors: boolean = false
): Response {
  const mergedHeaders = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });

  if (cors) {
    mergedHeaders.set('Access-Control-Allow-Origin', '*');
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: mergedHeaders,
  });
}

export async function runRequestSecurity(event: RequestEvent): Promise<Response | null> {
  const { url, request, platform, route } = event;
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (!isApiOrRegistryPath(pathname) || method === 'OPTIONS') {
    return null;
  }

  const routeId = route.id ?? null;
  const cors = isCorsProtectedPath(pathname);
  const tokenAuth = hasTokenAuthHeader(request);
  const anonymousCliBackgroundSubmit = isAnonymousCliBackgroundSubmitRequest(request);
  const sessionCookie = hasSessionCookie(request);

  if (
    isMcpPath(pathname) &&
    request.headers.has('origin') &&
    request.headers.get('origin') !== getCurrentRequestOrigin(url)
  ) {
    return securityJsonResponse(
      403,
      { error: 'Invalid MCP request origin' },
      { 'X-Security-Block': 'mcp-origin' },
      cors
    );
  }

  if (
    isMutationMethod(method) &&
    !tokenAuth &&
    !isCsrfExemptPath(pathname) &&
    sessionCookie
  ) {
    const sourceOrigin = getRequestSourceOrigin(request);
    const requestOrigin = getCurrentRequestOrigin(url);
    if (!sourceOrigin || sourceOrigin !== requestOrigin) {
      return securityJsonResponse(
        403,
        { error: 'Invalid request origin' },
        { 'X-Security-Block': 'csrf-origin' },
        cors
      );
    }
  }

  if (routeNeedsUaProtection(routeId, pathname)) {
    const ua = normalizeUserAgent(request.headers.get('user-agent'));
    if (!ua) {
      return securityJsonResponse(
        403,
        { error: 'User-Agent is required for this endpoint' },
        { 'X-Security-Block': 'ua-missing' },
        cors
      );
    }

    if (isMcpPath(pathname)) {
      if (isBlockedAutomation(ua)) {
        return securityJsonResponse(
          403,
          { error: 'Request blocked by abuse protection policy' },
          { 'X-Security-Block': 'ua-policy' },
          cors
        );
      }
    } else if (!isAllowedCrawler(ua)) {
      const allowedClient = isBrowserOrTrustedClient(ua);
      if (!allowedClient || isBlockedAutomation(ua)) {
        return securityJsonResponse(
          403,
          { error: 'Request blocked by abuse protection policy' },
          { 'X-Security-Block': 'ua-policy' },
          cors
        );
      }
    }
  }

  const kv = platform?.env?.KV;
  if (!kv) {
    return null;
  }

  const config = pickRateLimitConfig(
    routeId,
    pathname,
    url,
    method,
    tokenAuth,
    anonymousCliBackgroundSubmit,
    sessionCookie
  );
  const clientKey = await resolveRateLimitClientKey(request, platform?.env?.DB);
  const adaptiveOptions = getAdaptiveRateLimitOptions(platform?.env);
  const key = `${routeId ?? pathname}:${clientKey}`;
  const result = await checkRateLimit(kv, key, config, adaptiveOptions);

  if (!result.allowed) {
    return securityJsonResponse(
      429,
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        ...rateLimitHeaders(result),
        'Retry-After': String(Math.max(0, result.resetAt - Math.floor(Date.now() / 1000))),
      },
      cors
    );
  }

  return null;
}

export function shouldNoIndexPath(pathname: string): boolean {
  if (pathname === '/mcp') {
    return true;
  }

  if (pathname.startsWith('/api/')) {
    return true;
  }

  if (pathname.startsWith('/openclaw/api/')) {
    return true;
  }

  if (pathname.startsWith('/registry/')) {
    return true;
  }

  if (pathname === '/.well-known' || pathname.startsWith('/.well-known/')) {
    return true;
  }

  if (pathname === '/openclaw/.well-known' || pathname.startsWith('/openclaw/.well-known/')) {
    return true;
  }

  if (pathname === '/user' || pathname.startsWith('/user/')) {
    return true;
  }

  if (pathname === '/device' || pathname.startsWith('/device/')) {
    return true;
  }

  if (pathname === '/bookmarks' || pathname.startsWith('/bookmarks/')) {
    return true;
  }

  if (pathname === '/search' || pathname.startsWith('/search/')) {
    return true;
  }

  if (/^\/org\/[^/]+\/settings(?:\/|$)/.test(pathname)) {
    return true;
  }

  return false;
}
