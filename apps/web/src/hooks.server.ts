import { createAuth, linkAuthorToUser, type AuthEnv } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { runRequestSecurity, shouldNoIndexPath } from '$lib/server/request-security';

const NO_INDEX_VALUE = 'noindex, nofollow, noarchive';

function withNoIndexHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', NO_INDEX_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const handle: Handle = async ({ event, resolve }) => {
  const blocked = await runRequestSecurity(event);
  if (blocked) {
    return blocked;
  }

  const env = event.platform?.env as AuthEnv | undefined;

  // During build or if env is not available, skip auth
  if (building || !env?.DB) {
    event.locals.auth = async () => ({ user: null });
    event.locals.session = null;
    event.locals.user = null;
    const response = await resolve(event);
    return shouldNoIndexPath(event.url.pathname) ? withNoIndexHeader(response) : response;
  }

  // Get base URL from request
  const baseURL = `${event.url.protocol}//${event.url.host}`;

  // Create auth instance with runtime environment and base URL
  const auth = createAuth(env, baseURL);

  // Set up auth function on locals for use in endpoints and server load functions
  event.locals.auth = async () => {
    const sessionData = await auth.api.getSession({
      headers: event.request.headers,
    });
    return {
      user: sessionData?.user ?? null,
    };
  };

  // Also populate session and user directly for convenience
  const sessionData = await auth.api.getSession({
    headers: event.request.headers,
  });

  if (sessionData) {
    event.locals.session = sessionData.session;
    event.locals.user = sessionData.user;

    // Link author to user if not already linked (runs on each request but is idempotent)
    // This ensures that when a user signs up via GitHub OAuth, their existing indexed skills
    // are linked to their user account
    if (sessionData.user.id) {
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
      } catch (error) {
        console.error('[Auth] Failed to link author to user:', error);
      }
    }
  } else {
    event.locals.session = null;
    event.locals.user = null;
  }

  const response = await svelteKitHandler({ event, resolve, auth, building });
  return shouldNoIndexPath(event.url.pathname) ? withNoIndexHeader(response) : response;
};
