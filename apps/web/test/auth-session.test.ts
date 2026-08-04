import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock('$lib/auth-client', () => ({
  useSession: mocks.useSession,
}));

import { createLazyAuthSession, hasSessionCookieHint } from '../src/lib/auth-session';

describe('hasSessionCookieHint', () => {
  it('matches the plain better-auth session cookie', () => {
    expect(hasSessionCookieHint('better-auth.session_token=abc123')).toBe(true);
  });

  it('matches the __Secure- prefixed cookie used on HTTPS origins', () => {
    expect(hasSessionCookieHint('__Secure-better-auth.session_token=abc123')).toBe(true);
  });

  it('matches cookies that are not the first entry in the header', () => {
    expect(hasSessionCookieHint('skillscat_locale=en; better-auth.session_token=abc')).toBe(true);
  });

  it('matches the better-auth cookie cache cookie as a session hint', () => {
    expect(hasSessionCookieHint('__Secure-better-auth.session_data=abc')).toBe(true);
  });

  it('does not match unrelated cookies', () => {
    expect(hasSessionCookieHint('skillscat_locale=en; theme=dark')).toBe(false);
    expect(hasSessionCookieHint('')).toBe(false);
  });

  it('does not match cookies that merely contain the substring', () => {
    expect(hasSessionCookieHint('other=better-auth.session_token')).toBe(false);
    expect(hasSessionCookieHint('mybetter-auth.session_token=abc')).toBe(false);
  });
});

describe('createLazyAuthSession', () => {
  it('starts in a pending state matching the SSR render', () => {
    const { session } = createLazyAuthSession();
    expect(get(session)).toEqual({ data: null, isPending: true, error: null });
  });

  it('resolves to an anonymous state without loading the auth client', () => {
    const { session, start } = createLazyAuthSession();

    const stop = start(false);

    expect(get(session)).toEqual({ data: null, isPending: false, error: null });
    expect(mocks.useSession).not.toHaveBeenCalled();
    stop();
  });

  it('loads the auth client and forwards the real session when hinted', async () => {
    const user = { id: 'user-1', name: 'Ada', email: 'ada@example.com', image: null };
    mocks.useSession.mockReturnValue({
      subscribe(run: (value: unknown) => void) {
        run({ data: { user }, isPending: false, error: null });
        return () => {};
      },
    });

    const { session, start } = createLazyAuthSession();
    const stop = start(true);

    await vi.waitFor(() => {
      expect(mocks.useSession).toHaveBeenCalledTimes(1);
    });
    expect(get(session)).toEqual({ data: { user }, isPending: false, error: null });

    stop();
    mocks.useSession.mockReset();
  });
});
