import { createAuth, linkAuthorToUser, type AuthEnv } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle, ResolveOptions } from '@sveltejs/kit';
import { getXRobotsTagForPath, runRequestSecurity } from '$lib/server/security/request';
import { getCachedText, peekCachedText, putCachedText, setCacheVersion } from '$lib/server/cache';
import { getSkillBySlug } from '$lib/server/db/business/detail';
import {
  shouldForceDefaultLocaleForPublicPage,
  shouldUseDefaultLocaleForIndexablePage,
} from '$lib/server/seo/locale';
import { getCanonicalHostRedirectLocation } from '$lib/server/seo/host';
import {
  buildSkillSlug,
  getCanonicalSkillPathFromPathname,
  normalizeSkillName,
  normalizeSkillOwner,
} from '$lib/skill-path';
import { getHtmlLang, resolveRequestLocale } from '$lib/i18n/resolve';
import { LOCALE_COOKIE_NAME, type SupportedLocale } from '$lib/i18n/config';
import {
  buildOpenClawHomeMarkdown,
  buildOpenClawSkillMarkdown,
  isOpenClawUserAgent,
} from '$lib/server/openclaw/agent-markdown';
import {
  getSkillHtmlCacheKey,
  getSkillPublicHintCacheKey,
} from '$lib/server/cache/keys';
import { getPublicDiscoveryHtmlCacheKey } from '$lib/server/cache/public-html';
import { resolveTokenBackedIdentity } from '$lib/server/auth/request-user';
import type { SkillAccessPrincipal } from '$lib/server/auth/permissions';
import { getCurrentSkillVisibility } from '$lib/server/skill/visibility';

const NO_INDEX_VALUE = 'noindex, nofollow, noarchive';
const STATUS_OVERRIDE_HEADER = 'X-Skillscat-Status-Override';
const AUTHOR_LINK_COOKIE = 'sc-author-linked';
const AUTHOR_LINK_COOKIE_TTL_SECONDS = 24 * 60 * 60;
const PUBLIC_SKILL_HTML_CACHE_HEADER = 'X-Skillscat-Public-Skill-Cache';
const SKILL_HTML_CACHE_TTL_SECONDS = 5 * 60;
// The public hint now carries the authoritative visibility, so keep its TTL
// short: Cache API deletes only apply to the local data center, and a short
// TTL bounds how long a remote edge can serve stale visibility after a
// public-to-private transition.
const SKILL_PUBLIC_HINT_CACHE_TTL_SECONDS = 60;
const HOME_HTML_CACHE_TTL_SECONDS = 60;
const DISCOVERY_HTML_CACHE_TTL_SECONDS = 5 * 60;
const OPENCLAW_HOME_CACHE_KEY = 'ua:openclaw:home:v1';
const OPENCLAW_HOME_CACHE_TTL_SECONDS = 3600;
const OPENCLAW_SKILL_CACHE_TTL_SECONDS = 300;
const LEGACY_OPENCLAW_API_PREFIX = '/api/v1';
const OPENCLAW_API_PREFIX = '/openclaw/api/v1';
type RuntimeEnv = AuthEnv & {
  R2?: R2Bucket;
  CACHE_VERSION?: string;
};

function applyHtmlLang(html: string, lang: string): string {
  return html.replace(/<html lang="[^"]*">/, `<html lang="${lang}">`);
}

function withHtmlLangTransform(lang: string, options?: ResolveOptions): ResolveOptions {
  const existingTransform = options?.transformPageChunk;

  return {
    ...options,
    transformPageChunk: async ({ html, done }) => {
      const transformed = existingTransform ? await existingTransform({ html, done }) ?? html : html;
      return applyHtmlLang(transformed, lang);
    },
  };
}

function cloneResponseWithHeader(response: Response, key: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cloneResponseWithoutHeader(response: Response, key: string): Response {
  const headers = new Headers(response.headers);
  headers.delete(key);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cloneResponseWithStatus(response: Response, status: number): Response {
  return new Response(response.body, {
    status,
    headers: new Headers(response.headers),
  });
}

function cloneResponseWithHeaders(
  response: Response,
  updates: Record<string, string | null>
): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      headers.delete(key);
      continue;
    }

    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function applyResponseSecurityHeaders(pathname: string, response: Response): Response {
  let secured = response;

  const statusOverride = secured.headers.get(STATUS_OVERRIDE_HEADER);
  if (statusOverride) {
    secured = cloneResponseWithoutHeader(secured, STATUS_OVERRIDE_HEADER);
    const parsedStatus = Number.parseInt(statusOverride, 10);
    if (
      Number.isInteger(parsedStatus) &&
      parsedStatus >= 400 &&
      parsedStatus <= 599 &&
      parsedStatus !== secured.status
    ) {
      secured = cloneResponseWithStatus(secured, parsedStatus);
    }
  }

  if (pathname.startsWith('/api/') && !secured.headers.has('Cache-Control')) {
    secured = cloneResponseWithHeader(secured, 'Cache-Control', 'no-store');
  }

  const robotsTag = getXRobotsTagForPath(pathname);
  if (robotsTag) {
    secured = cloneResponseWithHeader(secured, 'X-Robots-Tag', robotsTag);
  }

  return secured;
}

function isHomeRouteRequest(event: Parameters<Handle>[0]['event']): boolean {
  return event.route.id === '/' && ['GET', 'HEAD'].includes(event.request.method);
}

function isSkillRouteRequest(event: Parameters<Handle>[0]['event']): boolean {
  return event.route.id === '/skills/[owner]/[...name]'
    && ['GET', 'HEAD'].includes(event.request.method);
}

function isSkillHtmlCacheableRequest(event: Parameters<Handle>[0]['event']): boolean {
  return event.request.method === 'GET'
    && !event.isDataRequest
    && event.route.id === '/skills/[owner]/[...name]';
}

function resolvePublicDiscoveryHtmlCacheKey(
  event: Parameters<Handle>[0]['event']
): string | null {
  return getPublicDiscoveryHtmlCacheKey({
    routeId: event.route.id,
    locale: event.locals.locale,
    searchParams: event.url.searchParams,
    params: {
      slug: event.params.slug,
    },
  });
}

function isPublicDiscoveryRouteRequest(event: Parameters<Handle>[0]['event']): boolean {
  return ['GET', 'HEAD'].includes(event.request.method)
    && !event.isDataRequest
    && resolvePublicDiscoveryHtmlCacheKey(event) !== null;
}

function isPublicDiscoveryHtmlCacheableRequest(event: Parameters<Handle>[0]['event']): boolean {
  return event.request.method === 'GET'
    && !event.isDataRequest
    && resolvePublicDiscoveryHtmlCacheKey(event) !== null;
}

function applySharedPublicHtmlCacheHeaders(
  response: Response,
  locale: SupportedLocale,
  cacheStatus: 'HIT' | 'MISS'
): Response {
  return cloneResponseWithHeaders(response, {
    // Shared caching is handled explicitly through the Worker Cache API with
    // locale-aware keys. Keep the HTTP response itself out of generic URL-based
    // caches so locale cookie variants cannot bleed across users.
    'Cache-Control': 'no-store',
    'Content-Language': locale,
    'Content-Type': response.headers.get('Content-Type') || 'text/html; charset=utf-8',
    Vary: null,
    'X-Cache': cacheStatus,
  });
}

function applySkillHtmlCacheHeaders(
  response: Response,
  locale: SupportedLocale,
  cacheStatus: 'HIT' | 'MISS'
): Response {
  return cloneResponseWithHeaders(response, {
    // Shared caching is handled explicitly through the Worker Cache API with
    // locale-aware keys. Keep the HTTP response itself out of generic URL-based
    // caches so locale or auth cookie variants cannot bleed across users.
    'Cache-Control': 'no-store',
    'Content-Language': locale,
    'Content-Type': response.headers.get('Content-Type') || 'text/html; charset=utf-8',
    Vary: null,
    'X-Cache': cacheStatus,
    [PUBLIC_SKILL_HTML_CACHE_HEADER]: null,
  });
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('text/html');
}

type SkillPageVisibility = 'public' | 'private' | 'unlisted' | null;

// Per-request memo so the HTML cache peek and the auth-skip check share one
// visibility resolution instead of each issuing their own lookup.
const skillPageVisibilityByEvent = new WeakMap<object, Promise<SkillPageVisibility>>();

function parseSkillPublicHint(hint: string | null): SkillPageVisibility | undefined {
  if (hint === null) {
    return undefined;
  }
  // Legacy entries only recorded that the skill was public.
  if (hint === '1' || hint === 'public') {
    return 'public';
  }
  if (hint === 'private' || hint === 'unlisted') {
    return hint;
  }
  return undefined;
}

function resolveSkillPageVisibility(
  event: Parameters<Handle>[0]['event'],
  slug: string
): Promise<SkillPageVisibility> {
  const pending = skillPageVisibilityByEvent.get(event);
  if (pending) {
    return pending;
  }

  const resolution = (async (): Promise<SkillPageVisibility> => {
    const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
    const hintKey = getSkillPublicHintCacheKey(slug);
    const cached = parseSkillPublicHint(await peekCachedText(hintKey, { waitUntil }));
    if (cached !== undefined) {
      return cached;
    }

    const db = event.platform?.env?.DB;
    if (!db) {
      return null;
    }

    const visibility = await getCurrentSkillVisibility(db, slug);
    if (visibility) {
      // Visibility mutations invalidate this key through
      // getSkillPageCacheInvalidationKeys, so caching it is safe; the short
      // TTL bounds cross-datacenter staleness.
      await putCachedText(hintKey, visibility, SKILL_PUBLIC_HINT_CACHE_TTL_SECONDS, {
        waitUntil,
        contentType: 'text/plain; charset=utf-8',
      });
    }
    return visibility;
  })();

  skillPageVisibilityByEvent.set(event, resolution);
  return resolution;
}

async function maybeRespondWithCachedSkillHtml(
  event: Parameters<Handle>[0]['event']
): Promise<Response | null> {
  if (!isSkillHtmlCacheableRequest(event)) {
    return null;
  }

  const slug = getSkillSlugFromPathname(event.url.pathname);
  if (!slug) {
    return null;
  }

  if (await resolveSkillPageVisibility(event, slug) !== 'public') {
    return null;
  }

  const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
  const cachedHtml = await peekCachedText(getSkillHtmlCacheKey(event.locals.locale, slug), { waitUntil });
  if (!cachedHtml) {
    return null;
  }

  return applySkillHtmlCacheHeaders(
    new Response(cachedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    }),
    event.locals.locale,
    'HIT'
  );
}

async function shouldSkipAuthForSharedSkillHtml(
  event: Parameters<Handle>[0]['event']
): Promise<boolean> {
  if (!isSkillRouteRequest(event)) {
    return false;
  }

  const slug = getSkillSlugFromPathname(event.url.pathname);
  if (!slug) {
    return false;
  }

  return await resolveSkillPageVisibility(event, slug) === 'public';
}

async function maybeRespondWithCachedDiscoveryHtml(
  event: Parameters<Handle>[0]['event']
): Promise<Response | null> {
  if (event.request.method !== 'GET' || event.isDataRequest) {
    return null;
  }

  const cacheKey = resolvePublicDiscoveryHtmlCacheKey(event);
  if (!cacheKey) {
    return null;
  }

  const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
  const cachedHtml = await peekCachedText(cacheKey, { waitUntil });
  if (!cachedHtml) {
    return null;
  }

  return applySharedPublicHtmlCacheHeaders(
    new Response(cachedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    }),
    event.locals.locale,
    'HIT'
  );
}

function maybeWriteDiscoveryHtmlCache(
  event: Parameters<Handle>[0]['event'],
  response: Response
): void {
  if (!isPublicDiscoveryHtmlCacheableRequest(event)) {
    return;
  }

  if (!response.ok || !isHtmlResponse(response)) {
    return;
  }

  // These routes render anonymously, but never let a personalized response
  // into the shared cache.
  if (response.headers.has('set-cookie')) {
    return;
  }

  const cacheKey = resolvePublicDiscoveryHtmlCacheKey(event);
  if (!cacheKey) {
    return;
  }

  const ttlSeconds = event.route.id === '/'
    ? HOME_HTML_CACHE_TTL_SECONDS
    : DISCOVERY_HTML_CACHE_TTL_SECONDS;
  const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
  const cacheWrite = (async () => {
    const html = await response.text();
    if (!html) {
      return;
    }

    await putCachedText(cacheKey, html, ttlSeconds, {
      waitUntil,
      contentType: 'text/html; charset=utf-8',
    });
  })();

  if (waitUntil) {
    waitUntil(cacheWrite);
    return;
  }

  void cacheWrite;
}

function maybeWriteSkillHtmlCache(
  event: Parameters<Handle>[0]['event'],
  response: Response
): void {
  if (!isSkillHtmlCacheableRequest(event)) {
    return;
  }

  if (response.headers.get(PUBLIC_SKILL_HTML_CACHE_HEADER) !== '1') {
    return;
  }

  if (!response.ok) {
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return;
  }

  const slug = getSkillSlugFromPathname(event.url.pathname);
  if (!slug) {
    return;
  }

  const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
  const cacheWrite = (async () => {
    const html = await response.text();
    if (!html) {
      return;
    }

    await Promise.all([
      putCachedText(
        getSkillHtmlCacheKey(event.locals.locale, slug),
        html,
        SKILL_HTML_CACHE_TTL_SECONDS,
        {
          waitUntil,
          contentType: 'text/html; charset=utf-8',
        }
      ),
      putCachedText(
        getSkillPublicHintCacheKey(slug),
        'public',
        SKILL_PUBLIC_HINT_CACHE_TTL_SECONDS,
        { waitUntil, contentType: 'text/plain; charset=utf-8' }
      ),
    ]);
  })();

  if (waitUntil) {
    waitUntil(cacheWrite);
    return;
  }

  void cacheWrite;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getSkillOwnerFromPathname(pathname: string): string | null {
  const pathOnly = pathname.replace(/\/+$/, '') || '/';
  const segments = pathOnly.split('/').filter(Boolean);
  if (segments[0] !== 'skills' || segments.length !== 2) {
    return null;
  }
  return safeDecodeURIComponent(segments[1] || '');
}

async function resolveProfilePathForSkillOwner(db: D1Database, ownerSegment: string): Promise<string | null> {
  const owner = normalizeSkillOwner(ownerSegment);
  if (!owner) return null;

  // Organization takes precedence for /org routing.
  const org = await db.prepare(`
    SELECT slug
    FROM organizations
    WHERE slug = ? COLLATE NOCASE
    LIMIT 1
  `)
    .bind(owner)
    .first<{ slug: string }>();

  if (org?.slug) {
    return `/org/${encodeURIComponent(org.slug)}`;
  }

  const user = await db.prepare(`
    SELECT name
    FROM user
    WHERE name = ? COLLATE NOCASE
    LIMIT 1
  `)
    .bind(owner)
    .first<{ name: string }>();

  if (user?.name) {
    return `/u/${encodeURIComponent(user.name)}`;
  }

  const author = await db.prepare(`
    SELECT username
    FROM authors
    WHERE username = ? COLLATE NOCASE
    LIMIT 1
  `)
    .bind(owner)
    .first<{ username: string }>();

  if (author?.username) {
    return `/u/${encodeURIComponent(author.username)}`;
  }

  return null;
}

function buildMarkdownResponse(body: string | null, options: {
  status?: number;
  cacheControl: string;
  vary: string;
  cacheStatus?: 'HIT' | 'MISS' | 'BYPASS';
}): Response {
  const headers = new Headers({
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': options.cacheControl,
    Vary: options.vary,
  });

  if (options.cacheStatus) {
    headers.set('X-Cache', options.cacheStatus);
  }

  return new Response(body, {
    status: options.status ?? 200,
    headers,
  });
}

function getLegacyOpenClawApiRedirectLocation(url: URL): string | null {
  if (url.pathname === LEGACY_OPENCLAW_API_PREFIX) {
    return `${OPENCLAW_API_PREFIX}${url.search}`;
  }

  if (!url.pathname.startsWith(`${LEGACY_OPENCLAW_API_PREFIX}/`)) {
    return null;
  }

  const suffix = url.pathname.slice(LEGACY_OPENCLAW_API_PREFIX.length);
  return `${OPENCLAW_API_PREFIX}${suffix}${url.search}`;
}

function buildPermanentRedirectResponse(location: string): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: location,
    },
  });
}

function buildApiRedirectResponse(location: string): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': NO_INDEX_VALUE,
    },
  });
}

function getSkillSlugFromPathname(pathname: string): string | null {
  const pathOnly = pathname.replace(/\/+$/, '') || '/';
  const segments = pathOnly.split('/').filter(Boolean);
  if (segments[0] !== 'skills' || segments.length < 3) {
    return null;
  }

  const owner = normalizeSkillOwner(safeDecodeURIComponent(segments[1] || ''));
  const name = normalizeSkillName(
    segments.slice(2).map((segment) => safeDecodeURIComponent(segment)).join('/')
  );

  return owner && name ? buildSkillSlug(owner, name) : null;
}

async function maybeRespondWithOpenClawHomeMarkdown(event: Parameters<Handle>[0]['event']): Promise<Response | null> {
  if (event.url.pathname !== '/') {
    return null;
  }

  if (!isOpenClawUserAgent(event.request.headers.get('user-agent'))) {
    return null;
  }

  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    return null;
  }

  const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
  const { data, hit } = await getCachedText(
    OPENCLAW_HOME_CACHE_KEY,
    async () => buildOpenClawHomeMarkdown(),
    OPENCLAW_HOME_CACHE_TTL_SECONDS,
    { waitUntil }
  );

  return buildMarkdownResponse(event.request.method === 'HEAD' ? null : data, {
    cacheControl: `public, max-age=${OPENCLAW_HOME_CACHE_TTL_SECONDS}, stale-while-revalidate=86400`,
    vary: 'User-Agent',
    cacheStatus: hit ? 'HIT' : 'MISS',
  });
}

async function maybeRespondWithOpenClawSkillMarkdown(
  event: Parameters<Handle>[0]['event'],
  env: RuntimeEnv,
  principal: SkillAccessPrincipal | null
): Promise<Response | null> {
  if (!isOpenClawUserAgent(event.request.headers.get('user-agent'))) {
    return null;
  }

  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    return null;
  }

  const slug = getSkillSlugFromPathname(event.url.pathname);
  if (!slug) {
    return null;
  }

  const skill = await getSkillBySlug(
    {
      DB: env.DB,
      R2: env.R2,
    },
    slug,
    principal
  );

  if (!skill) {
    const body = [
      '# Skill Not Found',
      '',
      'OpenClaw user agent detected.',
      '',
      `The skill \`${slug}\` was not found, or the current session does not have permission to view it.`,
      '',
      '- Search the registry from: https://skills.cat/',
      '- Machine guide: https://skills.cat/llm.txt',
      '- OpenClaw guide: https://skills.cat/docs/openclaw',
    ].join('\n');

    return buildMarkdownResponse(event.request.method === 'HEAD' ? null : body, {
      status: 404,
      cacheControl: 'no-store',
      vary: 'User-Agent, Authorization, Cookie',
      cacheStatus: 'BYPASS',
    });
  }

  if (skill.visibility === 'public') {
    const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);
    const freshnessToken = skill.updatedAt || skill.indexedAt || skill.createdAt || 0;
    const { data, hit } = await getCachedText(
      `ua:openclaw:skill:${skill.id}:${freshnessToken}`,
      async () => buildOpenClawSkillMarkdown(skill),
      OPENCLAW_SKILL_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    return buildMarkdownResponse(event.request.method === 'HEAD' ? null : data, {
      cacheControl: `public, max-age=${OPENCLAW_SKILL_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
      vary: 'User-Agent',
      cacheStatus: hit ? 'HIT' : 'MISS',
    });
  }

  return buildMarkdownResponse(
    event.request.method === 'HEAD' ? null : buildOpenClawSkillMarkdown(skill),
    {
      cacheControl: 'private, no-cache',
      vary: 'User-Agent, Authorization, Cookie',
      cacheStatus: 'BYPASS',
    }
  );
}

export const handle: Handle = async ({ event, resolve }) => {
  const shouldForceDefaultLocale = shouldForceDefaultLocaleForPublicPage(
    event.url.pathname,
    event.request.method
  );
  const resolvedLocale = resolveRequestLocale({
    cookieLocale: shouldForceDefaultLocale ? null : event.cookies.get(LOCALE_COOKIE_NAME),
    acceptLanguage: shouldForceDefaultLocale ? null : event.request.headers.get('accept-language'),
    preferDefaultLocale: shouldForceDefaultLocale || shouldUseDefaultLocaleForIndexablePage(
      event.url.pathname,
      event.request.method
    ),
  });
  event.locals.locale = resolvedLocale.locale;
  event.locals.localeSource = resolvedLocale.source;
  event.locals.htmlLang = getHtmlLang(resolvedLocale.locale);

  const canonicalHostLocation = getCanonicalHostRedirectLocation(
    event.url,
    (event.platform?.env as { PUBLIC_APP_URL?: string } | undefined)?.PUBLIC_APP_URL
  );
  if (canonicalHostLocation) {
    return buildPermanentRedirectResponse(canonicalHostLocation);
  }

  const canonicalSkillPath = getCanonicalSkillPathFromPathname(event.url.pathname);
  if (canonicalSkillPath && canonicalSkillPath !== event.url.pathname) {
    const location = `${canonicalSkillPath}${event.url.search}`;
    return buildPermanentRedirectResponse(location);
  }

  const legacyOpenClawApiLocation = getLegacyOpenClawApiRedirectLocation(event.url);
  if (legacyOpenClawApiLocation) {
    return buildApiRedirectResponse(legacyOpenClawApiLocation);
  }

  setCacheVersion((event.platform?.env as { CACHE_VERSION?: string } | undefined)?.CACHE_VERSION);

  const blocked = await runRequestSecurity(event);
  if (blocked) {
    return blocked;
  }

  const env = event.platform?.env as RuntimeEnv | undefined;

  const openClawHomeResponse = await maybeRespondWithOpenClawHomeMarkdown(event);
  if (openClawHomeResponse) {
    return openClawHomeResponse;
  }

  const cachedSkillResponse = await maybeRespondWithCachedSkillHtml(event);
  if (cachedSkillResponse) {
    return applyResponseSecurityHeaders(event.url.pathname, cachedSkillResponse);
  }

  const cachedDiscoveryResponse = await maybeRespondWithCachedDiscoveryHtml(event);
  if (cachedDiscoveryResponse) {
    return applyResponseSecurityHeaders(event.url.pathname, cachedDiscoveryResponse);
  }

  if (env?.DB) {
    const skillOwner = getSkillOwnerFromPathname(event.url.pathname);
    if (skillOwner) {
      const profilePath = await resolveProfilePathForSkillOwner(env.DB, skillOwner);
      if (profilePath) {
        const location = `${profilePath}${event.url.search}`;
        return buildPermanentRedirectResponse(location);
      }
    }
  }

  const shouldSkipAuthForHome = isHomeRouteRequest(event);
  const shouldSkipAuthForSharedSkill = await shouldSkipAuthForSharedSkillHtml(event);
  const shouldSkipAuthForPublicDiscovery = isPublicDiscoveryRouteRequest(event);

  // During build or if env is not available, skip auth
  if (
    building
    || !env?.DB
    || shouldSkipAuthForHome
    || shouldSkipAuthForSharedSkill
    || shouldSkipAuthForPublicDiscovery
  ) {
    event.locals.auth = async () => ({ user: null });
    event.locals.session = null;
    event.locals.user = null;
    event.locals.authPrincipal = null;
    const response = await resolve(event, withHtmlLangTransform(event.locals.htmlLang));
    const skillCacheWriteCandidate = isSkillHtmlCacheableRequest(event) ? response.clone() : null;
    const shouldApplySharedPublicHtmlOptimization = isPublicDiscoveryHtmlCacheableRequest(event)
      && isHtmlResponse(response);
    const discoveryCacheWriteCandidate = shouldApplySharedPublicHtmlOptimization
      ? response.clone()
      : null;
    const shouldApplySkillHtmlOptimization = response.headers.get(PUBLIC_SKILL_HTML_CACHE_HEADER) === '1'
      && isHtmlResponse(response);
    const optimizedResponse = shouldApplySharedPublicHtmlOptimization
      ? applySharedPublicHtmlCacheHeaders(response, event.locals.locale, 'MISS')
      : shouldApplySkillHtmlOptimization
        ? applySkillHtmlCacheHeaders(response, event.locals.locale, 'MISS')
        : response.headers.get(PUBLIC_SKILL_HTML_CACHE_HEADER) === '1'
          ? cloneResponseWithoutHeader(response, PUBLIC_SKILL_HTML_CACHE_HEADER)
          : response;

    if (skillCacheWriteCandidate) {
      maybeWriteSkillHtmlCache(event, skillCacheWriteCandidate);
    }

    if (discoveryCacheWriteCandidate) {
      maybeWriteDiscoveryHtmlCache(event, discoveryCacheWriteCandidate);
    }

    return applyResponseSecurityHeaders(event.url.pathname, optimizedResponse);
  }

  // Prefer the configured app URL (e.g. a dev proxy domain) over the request
  // origin so OAuth redirects never point at localhost.
  const configuredAppURL = (event.platform?.env as { PUBLIC_APP_URL?: string } | undefined)
    ?.PUBLIC_APP_URL?.trim();
  const baseURL = configuredAppURL || `${event.url.protocol}//${event.url.host}`;

  // Create auth instance with runtime environment and base URL
  const auth = createAuth(env, baseURL);
  let sessionDataPromise: Promise<Awaited<ReturnType<typeof auth.api.getSession>>> | null = null;
  const getSessionData = () => {
    if (!sessionDataPromise) {
      sessionDataPromise = auth.api.getSession({
        headers: event.request.headers,
      });
    }
    return sessionDataPromise;
  };

  // Set up auth function on locals for use in endpoints and server load functions
  event.locals.auth = async () => {
    const sessionData = await getSessionData();
    return {
      user: sessionData?.user ?? null,
    };
  };

  // Also populate session and user directly for convenience
  const sessionData = await getSessionData();

  if (sessionData) {
    event.locals.session = sessionData.session;
    event.locals.user = sessionData.user;
    event.locals.authPrincipal = {
      userId: sessionData.user.id,
      orgId: null,
      scopes: ['read', 'write', 'publish'],
    };

    if (sessionData.user.id) {
      const markerValue = `u:${sessionData.user.id}`;
      const marker = event.cookies.get(AUTHOR_LINK_COOKIE);
      if (marker !== markerValue) {
        let linkCheckCompleted = false;
        try {
          // Get the user's GitHub ID from the account table (created by Better Auth)
          const account = await env.DB.prepare(`
            SELECT account_id FROM account
            WHERE user_id = ? AND provider_id = 'github'
          `).bind(sessionData.user.id).first<{ account_id: string }>();

          if (account?.account_id) {
            const githubId = parseInt(account.account_id, 10);
            // This is idempotent - only updates if user_id IS NULL
            await linkAuthorToUser(env.DB, sessionData.user.id, githubId);
          }
          linkCheckCompleted = true;
        } catch (error) {
          console.error('[Auth] Failed to link author to user:', error);
        }

        if (linkCheckCompleted) {
          event.cookies.set(AUTHOR_LINK_COOKIE, markerValue, {
            path: '/',
            maxAge: AUTHOR_LINK_COOKIE_TTL_SECONDS,
            httpOnly: true,
            sameSite: 'lax',
            secure: event.url.protocol === 'https:',
          });
        }
      }
    }
  } else {
    event.locals.session = null;
    const tokenIdentity = isSkillRouteRequest(event)
      ? await resolveTokenBackedIdentity(event.request, env.DB)
      : null;
    event.locals.user = tokenIdentity?.user ?? null;
    event.locals.authPrincipal = tokenIdentity?.principal ?? null;
    event.locals.auth = async () => ({
      user: event.locals.user,
    });
  }

  const openClawSkillResponse = await maybeRespondWithOpenClawSkillMarkdown(
    event,
    env,
    event.locals.authPrincipal?.scopes.includes('read')
      ? {
          userId: event.locals.authPrincipal.userId,
          orgId: event.locals.authPrincipal.orgId,
        }
      : null
  );
  if (openClawSkillResponse) {
    return openClawSkillResponse;
  }

  const response = await svelteKitHandler({
    event,
    resolve: (currentEvent) => resolve(currentEvent, withHtmlLangTransform(event.locals.htmlLang)),
    auth,
    building,
  });
  const skillCacheWriteCandidate = isSkillHtmlCacheableRequest(event) ? response.clone() : null;
  const shouldApplySkillHtmlOptimization = response.headers.get(PUBLIC_SKILL_HTML_CACHE_HEADER) === '1'
    && isHtmlResponse(response);
  const optimizedResponse = shouldApplySkillHtmlOptimization
    ? applySkillHtmlCacheHeaders(response, event.locals.locale, 'MISS')
    : response.headers.get(PUBLIC_SKILL_HTML_CACHE_HEADER) === '1'
      ? cloneResponseWithoutHeader(response, PUBLIC_SKILL_HTML_CACHE_HEADER)
      : response;

  if (skillCacheWriteCandidate) {
    maybeWriteSkillHtmlCache(event, skillCacheWriteCandidate);
  }

  return applyResponseSecurityHeaders(event.url.pathname, optimizedResponse);
};
