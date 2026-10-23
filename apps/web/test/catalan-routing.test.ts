import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import * as svelteServer from 'svelte/internal/server';
import type { Component } from 'svelte';
import type { SupportedLocale } from '$lib/i18n/config';
import { reroute } from '../src/hooks';
import * as paths from '$lib/seo/locale-path';
import * as og from '$lib/seo/og';
import * as constants from '$lib/seo/constants';
import { getSeoLocaleMetadata } from '$lib/i18n/seo';
import { getLocaleFromAcceptLanguage, normalizeLocale, resolveRequestLocale } from '$lib/i18n/resolve';
import { createI18nRuntime, rememberPathLocale } from '$lib/i18n/runtime';
import { load as loadLayout } from '../src/routes/+layout.server';
import { getXRobotsTagForPath, shouldNoIndexPath } from '$lib/server/security/request';
import { buildUrlSetXml, getCoreSitemapPages } from '$lib/server/seo/sitemap';

const mocks = vi.hoisted(() => ({
  invalidateAll: vi.fn(async () => undefined),
  createAuth: vi.fn(),
  peekCachedResponse: vi.fn(async () => null),
}));

vi.mock('$app/environment', () => ({ browser: true, building: false, version: 'test-build' }));
vi.mock('$app/navigation', () => ({ invalidateAll: mocks.invalidateAll }));
vi.mock('$lib/server/auth', () => ({ createAuth: mocks.createAuth, linkAuthorToUser: vi.fn() }));
vi.mock('better-auth/svelte-kit', () => ({
  svelteKitHandler: vi.fn(async ({ event, resolve }) => resolve(event)),
}));
vi.mock('$lib/server/cache', () => ({
  getCachedText: vi.fn(), peekCachedText: vi.fn(async () => null), putCachedText: vi.fn(),
  peekCachedResponse: mocks.peekCachedResponse, putCachedResponse: vi.fn(),
  refreshCachedResponse: vi.fn(), setCacheVersion: vi.fn(), invalidateCache: vi.fn(),
}));
vi.mock('$lib/server/security/request', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/server/security/request')>(),
  runRequestSecurity: vi.fn(async () => null),
}));
vi.mock('$lib/server/skill/visibility', () => ({ getCurrentSkillVisibility: vi.fn(async () => 'private') }));
vi.mock('$lib/server/auth/request-user', () => ({ resolveTokenBackedIdentity: vi.fn(async () => null) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAuth.mockReturnValue({ api: { getSession: vi.fn(async () => null) } });
});
afterEach(() => vi.unstubAllGlobals());

function reroutePath(pathname: string) {
  return reroute({ url: new URL(`https://skills.cat${pathname}`), fetch: globalThis.fetch });
}

// Compile the real SEO component for SSR. Inject its small set of imports so
// the normal node-only Vitest setup can inspect rendered head tags without a
// separate browser or a second Vite/Svelte application.
const seoSource = readFileSync(new URL('../src/lib/components/common/SEO.svelte', import.meta.url), 'utf8');
const seoCode = compile(seoSource, { filename: 'SEO.svelte', generate: 'server' }).js.code
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace('export default function SEO', 'function SEO');
function renderSeo(pathname: string, props: Record<string, unknown> = {}, hasChineseIntroduction = false) {
  const locale = paths.getPathLocale(pathname);
  const dependencies = {
    $: svelteServer,
    page: { url: new URL(`https://skills.cat${pathname}`), data: { hasChineseIntroduction } },
    ...paths, ...og, ...constants, getSeoLocaleMetadata,
    useI18n: () => ({ locale: () => locale, href: (href: string) => paths.localizeHref(href, locale) }),
  };
  const component = new Function(...Object.keys(dependencies), `${seoCode}\nreturn SEO;`)(...Object.values(dependencies)) as Component<Record<string, unknown>>;
  return render(component, { props: { title: 'Prova', description: 'Descripció', url: pathname, ...props } }).head;
}

async function requestLocale(pathname: string, cookieLocale?: string, acceptLanguage = 'en') {
  const { handle } = await import('../src/hooks.server');
  const url = new URL(`https://skills.cat${pathname}`);
  const event = {
    url,
    request: new Request(url, { headers: { 'accept-language': acceptLanguage } }),
    route: { id: paths.stripSeoLocale(pathname) }, params: {}, locals: {},
    cookies: { get: vi.fn((name: string) => name === 'sc_locale' ? cookieLocale : undefined), set: vi.fn() },
    isDataRequest: false,
    platform: { env: {}, context: { waitUntil: vi.fn() } },
  };
  const resolve = vi.fn(async () => new Response('<html>test</html>', { headers: { 'content-type': 'text/html' } }));
  await handle({ event, resolve } as never);
  expect(event.cookies.set).not.toHaveBeenCalled();
  return event.locals as { locale: SupportedLocale; htmlLang: string };
}

describe('Catalan route resolution', () => {
  it.each([
    ['/ca', '/'], ['/ca/', '/'], ['/ca/docs', '/docs'], ['/ca/docs/cli', '/docs/cli'],
    ['/ca/search?q=catal%C3%A0', '/search'], ['/ca/category/i18n', '/category/i18n'],
    ['/ca/skills/acme/example', '/skills/acme/example'], ['/zh-CN/docs', '/docs'],
  ])('reroutes %s to the shared %s implementation', (input, expected) => {
    expect(reroutePath(input)).toBe(expected);
  });

  it.each(['/ca/blog', '/ca/blog/instal-lar-skills-amb-seguretat', '/ca/catala', '/ca/api/search', '/catalog'])('retains explicit or unsupported route %s', (path) => {
    expect(reroutePath(path)).toBe(path);
  });

  it('preserves query, fragment, and nested skill paths during switching', () => {
    expect(paths.localizeHref('/zh-CN/search?q=catal%C3%A0&page=2#results', 'ca')).toBe('/ca/search?q=catal%C3%A0&page=2#results');
    expect(paths.localizeHref('/ca/docs/cli#install', 'en')).toBe('/docs/cli#install');
    expect(paths.localizeHref('/skills/acme/nested/example?tab=files#readme', 'ca')).toBe('/ca/skills/acme/nested/example?tab=files#readme');
  });

  it('does not relabel Catalan-only articles or external destinations', () => {
    expect(paths.localizeHref('/ca/blog?from=footer#guides', 'en')).toBe('/ca/blog?from=footer#guides');
    expect(paths.localizeHref('/ca/catala', 'zh-CN')).toBe('/ca/catala');
    expect(paths.localizeHref('https://github.com/skillscat/skillscat', 'ca')).toBe('https://github.com/skillscat/skillscat');
    expect(paths.localizeHref('//example.com/docs', 'ca')).toBe('//example.com/docs');
  });
});

describe('Catalan locale preference and SSR', () => {
  it.each(['ca', 'ca-ES', 'ca-AD', ' CA-es '])('recognizes the Catalan language tag %s', (tag) => {
    expect(normalizeLocale(tag)).toBe('ca');
  });

  it('honors a saved preference on cookie-localized routes', () => {
    expect(resolveRequestLocale({ cookieLocale: 'ca', acceptLanguage: 'en' })).toEqual({ locale: 'ca', source: 'cookie' });
    expect(getLocaleFromAcceptLanguage('en;q=0.3,ca-AD;q=0.9')).toBe('ca');
  });

  it('does not select a language explicitly rejected with q=0', () => {
    expect(getLocaleFromAcceptLanguage('ca;q=0')).toBeNull();
    expect(getLocaleFromAcceptLanguage('ca;q=0,en;q=0.5')).toBe('en');
  });

  it.each(['/ca/docs', '/ca/search', '/ca/blog', '/ca/catala'])('gives the explicit Catalan path precedence at %s', async (path) => {
    expect(await requestLocale(path, 'en', 'zh-CN')).toMatchObject({ locale: 'ca', htmlLang: 'ca' });
  });

  it('does not turn an English deep link into Catalan based only on a cookie', async () => {
    expect(await requestLocale('/docs', 'ca', 'ca')).toMatchObject({ locale: 'en', htmlLang: 'en' });
  });

  it('stores the preference before navigating and retains a deep-link fragment', async () => {
    const order: string[] = [];
    const documentMock = { documentElement: { lang: 'en' } };
    Object.defineProperty(documentMock, 'cookie', { set: (cookie: string) => order.push(cookie) });
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('window', { location: { protocol: 'https:', pathname: '/docs/cli', search: '?from=footer', hash: '#install', assign: (href: string) => order.push(href) } });
    const runtime = createI18nRuntime({ getLocale: () => 'en', setLocale: vi.fn() });
    await runtime.switchLocale('ca');
    expect(order[0]).toContain('sc_locale=ca;');
    expect(order[0]).toContain('SameSite=Lax; Secure');
    expect(order[1]).toBe('/ca/docs/cli?from=footer#install');
    expect(mocks.invalidateAll).not.toHaveBeenCalled();
  });

  it('returns to the chosen homepage rather than relabeling Catalan editorial text', async () => {
    const assign = vi.fn();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('window', { location: { protocol: 'https:', pathname: '/ca/blog', assign } });
    const runtime = createI18nRuntime({ getLocale: () => 'ca', setLocale: vi.fn() });
    await runtime.switchLocale('en');
    expect(assign).toHaveBeenCalledWith('/');
  });
});

describe('locale history, repeated choices, and interrupted navigation regressions', () => {
  function browserState(pathname = '/') {
    let cookie = '';
    const writes: string[] = [];
    const documentMock = { documentElement: { lang: 'en' } };
    Object.defineProperty(documentMock, 'cookie', {
      get: () => cookie,
      set: (value: string) => { writes.push(value); cookie = value.split(';')[0]; },
    });
    const assign = vi.fn();
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('window', { location: { protocol: 'https:', pathname, search: '', hash: '', assign } });
    return { writes, assign, documentMock, cookie: () => cookie };
  }

  it('remembers both directions of a Catalan/English route history without redundant writes', () => {
    const state = browserState();
    for (const [path, locale] of [['/ca', 'ca'], ['/docs', 'en'], ['/ca', 'ca'], ['/docs', 'en']] as const) {
      rememberPathLocale(path, locale);
      expect(state.cookie()).toBe(`sc_locale=${locale}`);
    }
    rememberPathLocale('/docs', 'en');
    expect(state.writes).toHaveLength(4);
    // Account/profile routes use the saved preference, not a language prefix.
    rememberPathLocale('/settings/profile', 'ca');
    expect(state.cookie()).toBe('sc_locale=en');
  });

  it('restores cookie-only locales but does not erase them on English-only docs fallback', () => {
    const state = browserState();
    rememberPathLocale('/ca', 'ca');
    rememberPathLocale('/', 'ja');
    expect(state.cookie()).toBe('sc_locale=ja');
    rememberPathLocale('/docs/cli', 'en');
    expect(state.cookie()).toBe('sc_locale=ja');
    rememberPathLocale('/', 'ko');
    rememberPathLocale('/docs/openclaw/', 'en');
    expect(state.cookie()).toBe('sc_locale=ko');
    rememberPathLocale('/ca/docs', 'ca');
    expect(state.cookie()).toBe('sc_locale=ca');
    rememberPathLocale('/', 'en');
    expect(state.cookie()).toBe('sc_locale=en');
  });

  it.each(['/ca/docs', '/ca/docs/cli', '/ca/docs/openclaw', '/docs', '/docs/cli', '/zh-CN/docs/openclaw'])('sends unsupported ja/ko docs choices at %s to their chosen home', async (pathname) => {
    for (const nextLocale of ['ja', 'ko'] as const) {
      const state = browserState(pathname);
      const runtime = createI18nRuntime({ getLocale: () => 'ca', setLocale: vi.fn() });
      await runtime.switchLocale(nextLocale);
      expect(state.cookie()).toBe(`sc_locale=${nextLocale}`);
      expect(state.assign).toHaveBeenCalledWith('/');
      expect(mocks.invalidateAll).not.toHaveBeenCalled();
      expect(await requestLocale('/', nextLocale)).toMatchObject({ locale: nextLocale });
    }
  });

  it('ignores repeated selection of the currently active locale', async () => {
    const state = browserState('/ca/search');
    const setLocale = vi.fn();
    const runtime = createI18nRuntime({ getLocale: () => 'ca', setLocale });
    await runtime.switchLocale('ca');
    await runtime.switchLocale('ca');
    expect(state.writes).toHaveLength(0);
    expect(state.assign).not.toHaveBeenCalled();
    expect(setLocale).not.toHaveBeenCalled();
    expect(mocks.invalidateAll).not.toHaveBeenCalled();
  });

  it('keeps a newer cookie-page language choice when an older invalidation finishes last', async () => {
    const state = browserState('/settings/profile');
    let locale: SupportedLocale = 'en';
    let finishOlder!: () => void;
    let finishNewer!: () => void;
    mocks.invalidateAll.mockImplementationOnce(() => new Promise<void>((resolve) => { finishOlder = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishNewer = resolve; }));
    const runtime = createI18nRuntime({ getLocale: () => locale, setLocale: (next) => { locale = next; } });
    const older = runtime.switchLocale('ca');
    const newer = runtime.switchLocale('en');
    finishNewer(); await newer;
    finishOlder(); await older;
    expect(locale).toBe('en');
    expect(state.cookie()).toBe('sc_locale=en');
    expect(state.documentMock.documentElement.lang).toBe('en');
    expect(state.assign).not.toHaveBeenCalled();
  });

  it('resolves each visible path independently and tracks it for root-layout invalidation', async () => {
    for (const path of ['/', '/ca', '/', '/ca', '/ca/docs', '/docs']) {
      const locale = path.startsWith('/ca') ? 'ca' : 'en';
      const locals = await requestLocale(path, locale === 'ca' ? 'en' : 'ca');
      const readPath = vi.fn(() => path);
      const data = await loadLayout({ locals, url: { get pathname() { return readPath(); } } } as never);
      expect(readPath).toHaveBeenCalled();
      expect(data).toMatchObject({ locale, htmlLang: locale });
    }
  });
});

describe('Catalan SEO boundaries', () => {
  it('renders self-canonical Catalan docs and reciprocal language alternatives', () => {
    const head = renderSeo('/ca/docs', { url: '/docs' });
    expect(head).toContain('rel="canonical" href="https://skills.cat/ca/docs"');
    expect(head).toContain('hreflang="ca" href="https://skills.cat/ca/docs"');
    expect(head).toContain('hreflang="en" href="https://skills.cat/docs"');
    expect(head).toContain('hreflang="x-default" href="https://skills.cat/docs"');
    expect(head).toContain('property="og:locale" content="ca_ES"');
  });

  it('does not invent an English/Chinese equivalent for Catalan editorial content', () => {
    const head = renderSeo('/ca/blog/guia');
    expect(head).toContain('rel="canonical" href="https://skills.cat/ca/blog/guia"');
    expect(head).not.toContain('hreflang=');
  });

  it('does not advertise author-provided skill content as a Catalan translation', () => {
    const head = renderSeo('/ca/skills/acme/example', { url: '/skills/acme/example' });
    expect(head).toContain('rel="canonical" href="https://skills.cat/skills/acme/example"');
    expect(head).not.toContain('hreflang="ca"');
    expect(head).not.toContain('hreflang="zh-CN"');
  });

  it('retains valid Chinese skill alternatives without adding Catalan ones', () => {
    const head = renderSeo('/ca/skills/acme/example', { url: '/skills/acme/example' }, true);
    expect(head).toContain('hreflang="zh-CN" href="https://skills.cat/zh-CN/skills/acme/example"');
    expect(head).not.toContain('hreflang="ca"');
  });

  it('keeps localized search noindex in both HTTP and rendered metadata', () => {
    expect(shouldNoIndexPath('/ca/search')).toBe(true);
    expect(getXRobotsTagForPath('/ca/search')).toBe('noindex, follow, noarchive');
    const head = renderSeo('/ca/search', { noindex: true, robots: 'noindex, follow, noarchive' });
    expect(head).toContain('name="robots" content="noindex, follow, noarchive"');
    expect(head).not.toContain('hreflang=');
  });

  it('includes Catalan resources, but not invented Catalan skill entries, in sitemaps', () => {
    const xml = buildUrlSetXml([
      { url: '/docs', priority: '0.7', changefreq: 'monthly' },
      { url: '/skills/acme/example', priority: '0.5', changefreq: 'monthly' },
    ]);
    expect(xml).toContain('<loc>https://skills.cat/ca/docs</loc>');
    expect(xml).not.toContain('/ca/skills/');
    const coreXml = buildUrlSetXml(getCoreSitemapPages());
    expect(coreXml).toContain('/ca/blog</loc>');
    expect(coreXml).toContain('/ca/catala</loc>');
    expect(coreXml).not.toContain('/ca/search');
  });
});
