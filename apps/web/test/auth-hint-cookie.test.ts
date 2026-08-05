import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ building: false }));

import { AUTH_HINT_COOKIE_NAME, withAuthHintCookie } from '../src/hooks.server';

function htmlResponse(): Response {
  return new Response('<html></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('withAuthHintCookie', () => {
  it('sets the marker cookie on HTML responses when the request carries a session cookie', () => {
    const request = new Request('https://skills.cat/', {
      headers: { cookie: '__Secure-better-auth.session_token=abc123' },
    });
    const response = withAuthHintCookie(request, '/', htmlResponse());
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_HINT_COOKIE_NAME}=1`);
    expect(response.headers.get('set-cookie')).not.toContain('HttpOnly');
  });

  it('expires the marker cookie when the request has no session cookie', () => {
    const request = new Request('https://skills.cat/');
    const response = withAuthHintCookie(request, '/', htmlResponse());
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_HINT_COOKIE_NAME}=;`);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('leaves /api/auth responses untouched so better-auth owns its cookie flow', () => {
    const request = new Request('https://skills.cat/api/auth/sign-out', {
      headers: { cookie: '__Secure-better-auth.session_token=abc123' },
    });
    const response = withAuthHintCookie(request, '/api/auth/sign-out', htmlResponse());
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('does not attach cookies to non-HTML responses', () => {
    const request = new Request('https://skills.cat/_app/immutable/app.js', {
      headers: { cookie: '__Secure-better-auth.session_token=abc123' },
    });
    const asset = new Response('console.log(1)', {
      status: 200,
      headers: { 'content-type': 'text/javascript' },
    });
    const response = withAuthHintCookie(request, '/_app/immutable/app.js', asset);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
