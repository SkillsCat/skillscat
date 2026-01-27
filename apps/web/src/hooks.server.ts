import { auth, linkAuthorToUser } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
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
    const db = event.platform?.env?.DB;
    if (db && sessionData.user.id) {
      try {
        // Get the user's GitHub ID from the account table (created by Better Auth)
        const account = await db.prepare(`
          SELECT provider_account_id FROM account
          WHERE user_id = ? AND provider_id = 'github'
        `).bind(sessionData.user.id).first<{ provider_account_id: string }>();

        if (account?.provider_account_id) {
          const githubId = parseInt(account.provider_account_id, 10);
          // This is idempotent - only updates if user_id IS NULL
          await linkAuthorToUser(db, sessionData.user.id, githubId);
        }
      } catch (error) {
        // Silently ignore "no such table" errors - the account table is created by Better Auth
        // when the first user signs up, so it may not exist yet
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('no such table')) {
          console.error('[Auth] Failed to link author to user:', error);
        }
      }
    }
  } else {
    event.locals.session = null;
    event.locals.user = null;
  }

  return svelteKitHandler({ event, resolve, auth, building });
};
