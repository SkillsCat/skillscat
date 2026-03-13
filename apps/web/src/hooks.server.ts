import { createAuth, linkAuthorToUser, type AuthEnv } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle, ResolveOptions } from '@sveltejs/kit';
import { runRequestSecurity, shouldNoIndexPath } from '$lib/server/request-security';
import { getCachedText, setCacheVersion } from '$lib/server/cache';
import { getSkillBySlug } from '$lib/server/db/utils';
import {
  buildSkillSlug,
  getCanonicalSkillPathFromPathname,
  normalizeSkillName,
  normalizeSkillOwner,
} from '$lib/skill-path';
import { getHtmlLang, resolveRequestLocale } from '$lib/i18n/resolve';
import { LOCALE_COOKIE_NAME } from '$lib/i18n/config';
import {
  buildOpenClawHomeMarkdown,
  buildOpenClawSkillMarkdown,
  isOpenClawUserAgent,
} from '$lib/server/openclaw-agent-markdown';

const NO_INDEX_VALUE = 'noindex, nofollow, noarchive';
const STATUS_OVERRIDE_HEADER = 'X-Skillscat-Status-Override';
const AUTHOR_LINK_COOKIE = 'sc-author-linked';
const AUTHOR_LINK_COOKIE_TTL_SECONDS = 24 * 60 * 60;
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

  if (shouldNoIndexPath(pathname)) {
    secured = cloneResponseWithHeader(secured, 'X-Robots-Tag', NO_INDEX_VALUE);
  }

  return secured;
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

function getOpenClawSkillSlug(pathname: string): string | null {
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
  userId: string | null
): Promise<Response | null> {
  if (!isOpenClawUserAgent(event.request.headers.get('user-agent'))) {
    return null;
  }

  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    return null;
  }

  const slug = getOpenClawSkillSlug(event.url.pathname);
  if (!slug) {
    return null;
  }

  const skill = await getSkillBySlug(
    {
      DB: env.DB,
      R2: env.R2,
    },
    slug,
    userId
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
  const resolvedLocale = resolveRequestLocale({
    cookieLocale: event.cookies.get(LOCALE_COOKIE_NAME),
    acceptLanguage: event.request.headers.get('accept-language'),
  });
  event.locals.locale = resolvedLocale.locale;
  event.locals.localeSource = resolvedLocale.source;
  event.locals.htmlLang = getHtmlLang(resolvedLocale.locale);

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

  // During build or if env is not available, skip auth
  if (building || !env?.DB) {
    event.locals.auth = async () => ({ user: null });
    event.locals.session = null;
    event.locals.user = null;
    const response = await resolve(event, withHtmlLangTransform(event.locals.htmlLang));
    return applyResponseSecurityHeaders(event.url.pathname, response);
  }

  // Get base URL from request
  const baseURL = `${event.url.protocol}//${event.url.host}`;

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
    event.locals.user = null;
  }

  const openClawSkillResponse = await maybeRespondWithOpenClawSkillMarkdown(
    event,
    env,
    event.locals.user?.id ?? null
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
  return applyResponseSecurityHeaders(event.url.pathname, response);
};
