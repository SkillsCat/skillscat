import { writable, type Readable } from 'svelte/store';

/**
 * Lazy auth session store for the root layout.
 *
 * Statically importing `useSession` from '$lib/auth-client' pulls the whole
 * better-auth client into the main entry chunk, which anonymous visitors
 * (the majority of public traffic) pay to download, parse and execute even
 * though they have no session. This module keeps the layout auth-free:
 *
 * - The store starts in `{ isPending: true }` so SSR output and client
 *   hydration render identically (falling back to server-provided user data).
 * - `start()` (called from `onMount`) only dynamically imports the real auth
 *   client when there is evidence of a session (session cookie present, or
 *   the server already injected `currentUser` into layout data).
 * - Without any session hint the store resolves to an anonymous state and
 *   better-auth is never loaded.
 */

export interface SessionUserSnapshot {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export interface AuthSessionState {
  data: { user: SessionUserSnapshot } | null;
  isPending: boolean;
  error: unknown;
}

const PENDING_STATE: AuthSessionState = { data: null, isPending: true, error: null };
const ANONYMOUS_STATE: AuthSessionState = { data: null, isPending: false, error: null };

// better-auth cookies use the `better-auth.` prefix and additionally carry
// the `__Secure-` prefix on HTTPS origins.
const SESSION_COOKIE_PATTERN = /(?:^|;\s*)(?:__Secure-)?better-auth\./;

export function hasSessionCookieHint(cookieHeader: string): boolean {
  return SESSION_COOKIE_PATTERN.test(cookieHeader);
}

export interface LazyAuthSession {
  session: Readable<AuthSessionState>;
  /**
   * Resolve the session. Pass `hasSessionHint = true` when the server already
   * knows a user is signed in (e.g. layout data carries `currentUser`).
   * Returns a teardown function.
   */
  start: (hasSessionHint?: boolean) => () => void;
}

export function createLazyAuthSession(): LazyAuthSession {
  const store = writable<AuthSessionState>(PENDING_STATE);

  const start = (hasSessionHint = false): (() => void) => {
    const cookieHint =
      typeof document !== 'undefined' && hasSessionCookieHint(document.cookie);

    if (!hasSessionHint && !cookieHint) {
      store.set(ANONYMOUS_STATE);
      return () => {};
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    void import('$lib/auth-client')
      .then(({ useSession }) => {
        if (cancelled) return;
        unsubscribe = useSession().subscribe((value) => {
          store.set({
            data: value.data,
            isPending: value.isPending,
            error: value.error,
          });
        });
      })
      .catch((error: unknown) => {
        console.error('Failed to load auth client:', error);
        if (!cancelled) {
          store.set({ data: null, isPending: false, error });
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  };

  return { session: store, start };
}
