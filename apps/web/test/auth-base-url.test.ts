import { describe, expect, it } from 'vitest';
import { resolveAuthBaseURL } from '$lib/server/auth';

describe('resolveAuthBaseURL', () => {
  it('prefers PUBLIC_APP_URL over the request origin so dev proxies never use localhost', () => {
    expect(resolveAuthBaseURL(
      { PUBLIC_APP_URL: 'https://dev.example.com' },
      'http://localhost:8787'
    )).toBe('https://dev.example.com');
  });

  it('trims the configured URL', () => {
    expect(resolveAuthBaseURL(
      { PUBLIC_APP_URL: '  https://dev.example.com  ' },
      'http://localhost:8787'
    )).toBe('https://dev.example.com');
  });

  it('falls back to the request origin when PUBLIC_APP_URL is unset or blank', () => {
    expect(resolveAuthBaseURL({ PUBLIC_APP_URL: undefined }, 'http://localhost:8787'))
      .toBe('http://localhost:8787');
    expect(resolveAuthBaseURL({ PUBLIC_APP_URL: '   ' }, 'http://localhost:8787'))
      .toBe('http://localhost:8787');
  });

  it('falls back to the production site URL without any input', () => {
    expect(resolveAuthBaseURL({})).toBe('https://skills.cat');
  });
});
