import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ building: false }));

import {
  AUTH_HINT_COOKIE_NAME,
  withAuthHintCookie,
  withWorkersCacheSafety,
} from '../src/hooks.server';

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

  it('sets the marker when an HTML response issues a session cookie', () => {
    const request = new Request('https://skills.cat/');
    const response = withAuthHintCookie(request, '/', new Response('<html></html>', {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': '__Secure-better-auth.session_token=session123; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
    }));
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_HINT_COOKIE_NAME}=1`);
  });

  it('expires the marker cookie when the request has no session cookie', () => {
    const request = new Request('https://skills.cat/');
    const response = withAuthHintCookie(request, '/', htmlResponse());
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_HINT_COOKIE_NAME}=;`);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('does not add a deletion cookie to a CDN-cacheable anonymous HTML response', () => {
    const request = new Request('https://skills.cat/');
    const response = withAuthHintCookie(request, '/', new Response('<html></html>', {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'Cloudflare-CDN-Cache-Control': 'public, max-age=60',
      },
    }));
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('mirrors a session cookie issued by the OAuth callback', () => {
    const request = new Request('https://skills.cat/api/auth/callback/github');
    const response = withAuthHintCookie(request, '/api/auth/callback/github', new Response(null, {
      status: 302,
      headers: {
        location: '/',
        'set-cookie': '__Secure-better-auth.session_token=session123; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
    }));
    expect(response.headers.get('set-cookie')).toContain('__Secure-better-auth.session_token=session123');
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_HINT_COOKIE_NAME}=1`);
  });

  it('mirrors session cookie deletion on auth routes', () => {
    const request = new Request('https://skills.cat/api/auth/sign-out');
    const response = withAuthHintCookie(request, '/api/auth/sign-out', new Response(null, {
      status: 200,
      headers: {
        'set-cookie': '__Secure-better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      },
    }));
    expect(response.headers.get('set-cookie')).toContain(`${AUTH_HINT_COOKIE_NAME}=;`);
  });

  it('leaves auth responses without session cookie changes untouched', () => {
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

describe('withWorkersCacheSafety', () => {
  it('opts unspecified responses out of Workers Cache heuristic caching', () => {
    const response = withWorkersCacheSafety(htmlResponse());
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
  });

  it('preserves an explicit public SSR cache policy', () => {
    const response = withWorkersCacheSafety(new Response('<html></html>', {
      headers: {
        'content-type': 'text/html',
        'Cloudflare-CDN-Cache-Control': 'public, max-age=60',
      },
    }));
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('public, max-age=60');
  });
});
