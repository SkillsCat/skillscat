import type { RequestEvent } from '@sveltejs/kit';
import {
  RATE_LIMITS,
  checkRateLimit,
  getRateLimitKey,
  rateLimitHeaders,
  type AdaptiveRateLimitOptions,
} from '$lib/server/ratelimit';

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
  '/api/skills/upload',
  '/api/skills/[slug]/download',
  '/api/skills/[slug]/files',
  '/api/skills/[slug]/file',
  '/api/skills/[slug]/track-install',
  '/registry/skill/[owner]/[name]',
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
  if (pathname.startsWith('/api/')) {
    return true;
  }

  if (pathname.startsWith('/registry/skill/')) {
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
    /^\/api\/skills\/.+\/(download|files|file|track-install)$/.test(pathname) ||
    pathname === '/api/skills/upload' ||
    /^\/registry\/skill\//.test(pathname)
  );
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

async function getSubmitTokenRateLimitKey(request: Request): Promise<string | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const bytes = Array.from(new Uint8Array(digest).slice(0, 12));
    const fingerprint = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `tk:${fingerprint}`;
  } catch {
    return null;
  }
}

function pickRateLimitConfig(routeId: string | null, pathname: string, method: string, tokenAuth: boolean): RateLimitConfig {
  if (isSubmitRoute(routeId, pathname)) {
    return tokenAuth ? RATE_LIMITS.submitToken : RATE_LIMITS.submit;
  }

  if (routeId === '/api/skills/upload' || pathname === '/api/skills/upload') {
    return UPLOAD_LIMIT;
  }

  if (routeId && AUTH_ROUTE_IDS.has(routeId)) {
    return AUTH_FLOW_LIMIT;
  }

  if (
    routeId === '/api/skills/[slug]/files' ||
    routeId === '/api/skills/[slug]/download' ||
    routeId === '/registry/skill/[owner]/[name]'
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
  const cors = pathname.startsWith('/registry/');
  const tokenAuth = hasTokenAuthHeader(request);

  if (
    isMutationMethod(method) &&
    !tokenAuth &&
    !isCsrfExemptPath(pathname) &&
    hasSessionCookie(request)
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

    if (!isAllowedCrawler(ua)) {
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

  const config = pickRateLimitConfig(routeId, pathname, method, tokenAuth);
  let clientKey = getRateLimitKey(request);
  if (tokenAuth && isSubmitRoute(routeId, pathname)) {
    const tokenKey = await getSubmitTokenRateLimitKey(request);
    if (tokenKey) {
      clientKey = tokenKey;
    }
  }
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
  if (pathname.startsWith('/api/')) {
    return true;
  }

  if (pathname.startsWith('/registry/')) {
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
