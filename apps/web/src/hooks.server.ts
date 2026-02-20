import { createAuth, linkAuthorToUser, type AuthEnv } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { runRequestSecurity, shouldNoIndexPath } from '$lib/server/request-security';
import { setCacheVersion } from '$lib/server/cache';
import { getCanonicalSkillPathFromPathname, normalizeSkillOwner } from '$lib/skill-path';

const NO_INDEX_VALUE = 'noindex, nofollow, noarchive';
const STATUS_OVERRIDE_HEADER = 'X-Skillscat-Status-Override';
const AUTHOR_LINK_COOKIE = 'sc-author-linked';
const AUTHOR_LINK_COOKIE_TTL_SECONDS = 24 * 60 * 60;

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

export const handle: Handle = async ({ event, resolve }) => {
  const canonicalSkillPath = getCanonicalSkillPathFromPathname(event.url.pathname);
  if (canonicalSkillPath && canonicalSkillPath !== event.url.pathname) {
    const location = `${canonicalSkillPath}${event.url.search}`;
    return new Response(null, {
      status: 308,
      headers: { Location: location },
    });
  }

  setCacheVersion((event.platform?.env as { CACHE_VERSION?: string } | undefined)?.CACHE_VERSION);

  const blocked = await runRequestSecurity(event);
  if (blocked) {
    return blocked;
  }

  const env = event.platform?.env as AuthEnv | undefined;

  if (env?.DB) {
    const skillOwner = getSkillOwnerFromPathname(event.url.pathname);
    if (skillOwner) {
      const profilePath = await resolveProfilePathForSkillOwner(env.DB, skillOwner);
      if (profilePath) {
        const location = `${profilePath}${event.url.search}`;
        return new Response(null, {
          status: 308,
          headers: { Location: location },
        });
      }
    }
  }

  // During build or if env is not available, skip auth
  if (building || !env?.DB) {
    event.locals.auth = async () => ({ user: null });
    event.locals.session = null;
    event.locals.user = null;
    const response = await resolve(event);
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

  const response = await svelteKitHandler({ event, resolve, auth, building });
  return applyResponseSecurityHeaders(event.url.pathname, response);
};
