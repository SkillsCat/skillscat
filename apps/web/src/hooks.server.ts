import { auth } from '$lib/server/auth';
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
  } else {
    event.locals.session = null;
    event.locals.user = null;
  }

  return svelteKitHandler({ event, resolve, auth, building });
};
