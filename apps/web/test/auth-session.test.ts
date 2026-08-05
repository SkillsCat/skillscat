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
  it('matches the server-issued auth hint marker cookie', () => {
    expect(hasSessionCookieHint('sc_auth_hint=1')).toBe(true);
  });

  it('matches the marker cookie when it is not the first entry', () => {
    expect(hasSessionCookieHint('skillscat_locale=en; sc_auth_hint=1')).toBe(true);
  });

  it('does not match HttpOnly better-auth cookies, which document.cookie never exposes', () => {
    expect(hasSessionCookieHint('better-auth.session_token=abc123')).toBe(false);
    expect(hasSessionCookieHint('__Secure-better-auth.session_token=abc123')).toBe(false);
  });

  it('does not match a cleared or falsey marker cookie', () => {
    expect(hasSessionCookieHint('sc_auth_hint=')).toBe(false);
    expect(hasSessionCookieHint('sc_auth_hint=0')).toBe(false);
  });

  it('does not match unrelated cookies', () => {
    expect(hasSessionCookieHint('skillscat_locale=en; theme=dark')).toBe(false);
    expect(hasSessionCookieHint('')).toBe(false);
  });

  it('does not match cookies that merely contain the substring', () => {
    expect(hasSessionCookieHint('other=sc_auth_hint=1')).toBe(false);
    expect(hasSessionCookieHint('sc_auth_hint=10')).toBe(false);
    expect(hasSessionCookieHint('xsc_auth_hint=1')).toBe(false);
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
