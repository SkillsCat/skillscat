import { describe, expect, it } from 'vitest';
import { getRateLimitKey } from '../src/lib/server/security/ratelimit';

describe('ratelimit client IP extraction', () => {
  it('uses cf-connecting-ip when Cloudflare provides a direct client IP', () => {
    const request = new Request('https://skills.cat/registry/search?q=test', {
      headers: {
        'cf-connecting-ip': '198.51.100.24',
        'x-forwarded-for': '203.0.113.10',
      },
    });

    expect(getRateLimitKey(request)).toBe('198.51.100.24');
  });

  it('uses cf-connecting-ipv6 when pseudo IPv4 overwrites cf-connecting-ip', () => {
    const request = new Request('https://skills.cat/registry/search?q=test', {
      headers: {
        'cf-connecting-ip': '240.0.0.7',
        'cf-connecting-ipv6': '2001:db8::7',
        'x-forwarded-for': '240.0.0.7',
      },
    });

    expect(getRateLimitKey(request)).toBe('2001:db8::7');
  });

  it('falls back to x-forwarded-for outside Cloudflare', () => {
    const request = new Request('https://skills.cat/registry/search?q=test', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 198.51.100.20',
      },
    });

    expect(getRateLimitKey(request)).toBe('203.0.113.10');
  });
});
