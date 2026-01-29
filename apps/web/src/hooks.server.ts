import { createAuth, linkAuthorToUser, type AuthEnv } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const env = event.platform?.env as AuthEnv | undefined;

  // During build or if env is not available, skip auth
  if (building || !env?.DB) {
    event.locals.auth = async () => ({ user: null });
    event.locals.session = null;
    event.locals.user = null;
    return resolve(event);
  }

  // Create auth instance with runtime environment
  const auth = createAuth(env);

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

  return svelteKitHandler({ event, resolve, auth, building });
};
