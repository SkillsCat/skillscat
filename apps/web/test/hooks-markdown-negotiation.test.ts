import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ building: false }));

import {
  acceptsMarkdown,
  htmlToMarkdown,
  withMarkdownNegotiation,
} from '../src/hooks.server';

const html = `<!doctype html>
<html>
  <head>
    <meta name="title" content="Agent-ready: Skills &amp; tools" />
    <meta name="description" content="Find useful skills." />
    <meta property="og:image" content="https://skills.cat/og" />
    <style>body { display: none }</style>
  </head>
  <body>
    <nav>Global navigation</nav>
    <main>
      <h1>Skills &amp; tools</h1>
      <p>Install an <strong>agent skill</strong>.</p>
      <ul><li><a href="/skills/example/demo">Demo</a></li></ul>
      <pre><code>&lt;main&gt;example&lt;/main&gt;</code></pre>
      <script>window.secret = true</script>
    </main>
    <footer>Global footer</footer>
  </body>
</html>`;

describe('Markdown content negotiation', () => {
  it('requires an explicit, allowed text/markdown media type', () => {
    expect(acceptsMarkdown(new Request('https://skills.cat/', {
      headers: { Accept: 'text/markdown, text/html;q=0.9' },
    }))).toBe(true);
    expect(acceptsMarkdown(new Request('https://skills.cat/', {
      headers: { Accept: 'text/markdown; q=0' },
    }))).toBe(false);
    expect(acceptsMarkdown(new Request('https://skills.cat/', {
      headers: { Accept: 'text/markdown; q = 0' },
    }))).toBe(false);
    expect(acceptsMarkdown(new Request('https://skills.cat/', {
      headers: { Accept: 'text/html, */*;q=0.8' },
    }))).toBe(false);
  });

  it('converts the main page content without global layout noise', () => {
    const markdown = htmlToMarkdown(html);

    expect(markdown).toContain('title: "Agent-ready: Skills & tools"');
    expect(markdown).toContain('description: "Find useful skills."');
    expect(markdown).toContain('# Skills & tools');
    expect(markdown).toContain('- [Demo](/skills/example/demo)');
    expect(markdown).toContain('```\n<main>example</main>\n```');
    expect(markdown).not.toContain('Global navigation');
    expect(markdown).not.toContain('Global footer');
    expect(markdown).not.toContain('window.secret');
  });

  it('returns Markdown with negotiation and token headers while preserving response policy', async () => {
    const request = new Request('https://skills.cat/trending', {
      headers: { Accept: 'application/json, text/markdown;q=0.9' },
    });
    const response = new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'Cloudflare-CDN-Cache-Control': 'public, max-age=60',
        'Content-Length': String(html.length),
        ETag: '"html-version"',
        Vary: 'Cookie',
      },
    });

    const negotiated = await withMarkdownNegotiation(request, response);

    expect(negotiated.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(negotiated.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(negotiated.headers.get('Cloudflare-CDN-Cache-Control')).toBeNull();
    expect(negotiated.headers.get('Vary')).toBe('Cookie, Accept');
    expect(Number(negotiated.headers.get('x-markdown-tokens'))).toBeGreaterThan(0);
    expect(negotiated.headers.get('Content-Length')).toBeNull();
    expect(negotiated.headers.get('ETag')).toBeNull();
    expect(await negotiated.text()).toContain('# Skills & tools');
  });

  it('leaves browser HTML and non-HTML responses unchanged', async () => {
    const htmlResponse = new Response(html, { headers: { 'Content-Type': 'text/html' } });
    const browserResponse = await withMarkdownNegotiation(
      new Request('https://skills.cat/', { headers: { Accept: 'text/html' } }),
      htmlResponse
    );
    const jsonResponse = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    const agentJsonResponse = await withMarkdownNegotiation(
      new Request('https://skills.cat/api/search', { headers: { Accept: 'text/markdown' } }),
      jsonResponse
    );

    expect(browserResponse.headers.get('Content-Type')).toBe('text/html');
    expect(browserResponse.headers.get('Vary')).toBe('Accept');
    expect(await browserResponse.text()).toBe(html);
    expect(agentJsonResponse).toBe(jsonResponse);
    expect(agentJsonResponse.headers.get('Content-Type')).toBe('application/json');
  });

  it('negotiates HEAD responses without adding a body', async () => {
    const response = await withMarkdownNegotiation(
      new Request('https://skills.cat/', {
        method: 'HEAD',
        headers: { Accept: 'text/markdown' },
      }),
      new Response(null, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    );

    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(await response.text()).toBe('');
  });

  it('preserves bodyless HTML response statuses', async () => {
    const response = await withMarkdownNegotiation(
      new Request('https://skills.cat/', { headers: { Accept: 'text/markdown' } }),
      new Response(null, {
        status: 304,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );

    expect(response.status).toBe(304);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(await response.text()).toBe('');
  });
});
