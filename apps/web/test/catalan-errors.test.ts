import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import * as svelteServer from 'svelte/internal/server';
import type { Component } from 'svelte';
import { getMessages } from '$lib/i18n/messages';
import { getSkillPageCopy, getSkillPageErrorMessage } from '$lib/i18n/skill-page';
import { localizeHref } from '$lib/seo/locale-path';
import type { SupportedLocale } from '$lib/i18n/config';

const source = readFileSync(new URL('../src/routes/+error.svelte', import.meta.url), 'utf8');
const code = compile(source, { filename: 'ErrorPage.svelte', generate: 'server' }).js.code
  .replace(/^import[\s\S]*?;\n/gm, '')
  .replace('export default function ErrorPage', 'function ErrorPage');

// Run the real route component's SSR logic. Stub only its presentational child
// to inspect the localized message and action that it actually receives.
function renderError(locale: SupportedLocale, status: number, message: string) {
  let props: Record<string, unknown> = {};
  const dependencies = {
    $: svelteServer,
    page: { subscribe: (subscriber: (value: unknown) => void) => {
      subscriber({ status, error: { message } });
      return () => undefined;
    } },
    useI18n: () => ({ locale: () => locale, messages: () => getMessages(locale), href: (href: string) => localizeHref(href, locale) }),
    ErrorState: (_renderer: unknown, value: Record<string, unknown>) => { props = value; },
  };
  const component = new Function(...Object.keys(dependencies), `${code}\nreturn ErrorPage;`)(...Object.values(dependencies)) as Component;
  const result = render(component);
  const head = result.head;
  return { props, head };
}

describe('Catalan error recovery', () => {
  it('localizes framework errors and keeps the home action in Catalan', () => {
    const result = renderError('ca', 404, 'Page not found');
    expect(result.props).toMatchObject({
      title: getMessages('ca').errorPage.notFoundTitle,
      message: getMessages('ca').errorPage.notFoundMessage,
      primaryActionHref: '/ca',
    });
    expect(result.head).not.toContain('Page not found');
    expect(result.head).toContain('noindex, nofollow');
  });

  it('retains useful route-specific Catalan messages', () => {
    expect(renderError('ca', 404, 'No s’ha trobat aquest article.').props.message)
      .toBe('No s’ha trobat aquest article.');
  });

  it('does not change existing English errors or home destinations', () => {
    expect(renderError('en', 404, 'Page not found').props).toMatchObject({
      message: 'Page not found', primaryActionHref: '/',
    });
  });

  it('does not let the typed English skill error override the Catalan permission-safe message', () => {
    expect(getSkillPageErrorMessage('ca', 'not_found', 'Skill not found or you do not have permission to view it.'))
      .toBe('No s’ha trobat l’skill o no tens permís per veure’l.');
    expect(getSkillPageErrorMessage('ca', 'temporary_failure', 'Failed to load skill'))
      .toBe(getSkillPageCopy('ca').temporarilyUnavailableMessage);
    expect(getSkillPageErrorMessage('en', 'not_found', 'Skill not found or you do not have permission to view it.'))
      .toBe('Skill not found or you do not have permission to view it.');
  });
});
