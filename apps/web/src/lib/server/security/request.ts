import type { RequestEvent } from '@sveltejs/kit';
import {
  checkDurableRateLimit,
  checkRateLimit,
  getRateLimitKey,
  rateLimitHeaders,
  type AdaptiveRateLimitOptions,
  type RateLimitConfig,
} from '$lib/server/security/ratelimit';
import { validateApiToken } from '$lib/server/auth/api';

const PRIVATE_READ_LIMIT: RateLimitConfig = {
  limit: 300,
  windowSeconds: 60,
  prefix: 'rl:api:private-read',
};

const CSRF_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/device\/(authorize|code|token|refresh)$/,
  /^\/registry\/auth\/(authorize|init|token)$/,
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
  /\bgoogleother(?:-[a-z]+)?\b/i,
  /\bgoogle-inspectiontool\b/i,
  /\badsbot-google(?:-mobile)?\b/i,
  /\bmediapartners-google\b/i,
  /\bstorebot-google\b/i,
  /\bfeedfetcher-google\b/i,
  /\bapis-google\b/i,
  /\bgoogle-read-aloud\b/i,
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

const SECURITY_NO_INDEX_VALUE = 'noindex, nofollow, noarchive';

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

function isPrivateReadRoute(routeId: string | null, pathname: string): boolean {
  return (
    routeId === '/api/orgs/[slug]' ||
    /^\/api\/orgs\/[^/]+$/.test(pathname) ||
    routeId === '/api/orgs/[slug]/members' ||
    /^\/api\/orgs\/[^/]+\/members$/.test(pathname) ||
    routeId === '/api/orgs/[slug]/skills' ||
    /^\/api\/orgs\/[^/]+\/skills$/.test(pathname) ||
    routeId === '/api/notifications' ||
    pathname === '/api/notifications' ||
    routeId === '/api/notifications/unread-count' ||
    pathname === '/api/notifications/unread-count' ||
    routeId === '/api/favorites' ||
    pathname === '/api/favorites' ||
    routeId === '/api/user/skills' ||
    pathname === '/api/user/skills'
  );
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

function pickRateLimitConfig(
  routeId: string | null,
  pathname: string,
  method: string,
): RateLimitConfig | null {
  if (!['GET', 'HEAD'].includes(method)) {
    return null;
  }

  return isPrivateReadRoute(routeId, pathname) ? PRIVATE_READ_LIMIT : null;
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
    'X-Robots-Tag': SECURITY_NO_INDEX_VALUE,
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

  const stateDo = platform?.env?.STATE_DO;
  const kv = platform?.env?.KV;
  if (!stateDo && !kv) {
    return null;
  }

  const config = pickRateLimitConfig(routeId, pathname, method);
  if (!config) {
    return null;
  }

  const clientKey = await resolveRateLimitClientKey(request, platform?.env?.DB);
  const adaptiveOptions = getAdaptiveRateLimitOptions(platform?.env);
  const key = `${routeId ?? pathname}:${clientKey}`;
  const result = stateDo
    ? await checkDurableRateLimit(stateDo, key, config, adaptiveOptions)
    : await checkRateLimit(kv!, key, config, adaptiveOptions);

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
