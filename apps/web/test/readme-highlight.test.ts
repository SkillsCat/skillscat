import { describe, expect, it, vi } from 'vitest';
import { renderReadmeMarkdown } from '../src/lib/server/text/markdown';
import {
  highlightReadmeHtml,
  renderHighlightedReadmeMarkdown,
} from '../src/lib/server/text/highlight';
import {
  buildHighlightedReadmeR2Key,
  buildHighlightedReadmeR2Prefix,
  getOrRenderHighlightedReadme,
} from '../src/lib/server/skill/highlighted-readme';

function createFakeR2(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    get: vi.fn(async (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : { text: async () => value };
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('highlightReadmeHtml', () => {
  it('highlights code blocks with dual github themes on the server', async () => {
    const html = renderReadmeMarkdown('```ts\nconst answer: number = 42;\n```\n');
    const highlighted = await highlightReadmeHtml(html);

    expect(highlighted).toContain('class="shiki shiki-themes github-light github-dark"');
    expect(highlighted).toContain('--shiki-dark:');
    expect(highlighted).not.toContain('<pre><code class="language-ts">');
    expect(highlighted).toContain('answer');
  });

  it('resolves language aliases the same way the client highlighter did', async () => {
    const html = renderReadmeMarkdown('```bash\npnpm install\n```\n');
    const highlighted = await highlightReadmeHtml(html);

    expect(highlighted).toContain('class="shiki shiki-themes github-light github-dark"');
    expect(highlighted).toContain('pnpm');
  });

  it('falls back to plaintext shiki output for unknown or missing languages', async () => {
    const unknown = await highlightReadmeHtml(
      renderReadmeMarkdown('```made-up-language\nhello world\n```\n')
    );
    expect(unknown).toContain('class="shiki');
    expect(unknown).toContain('hello world');

    const bare = await highlightReadmeHtml(renderReadmeMarkdown('```\nplain code\n```\n'));
    expect(bare).toContain('class="shiki');
    expect(bare).toContain('plain code');
  });

  it('keeps the filename wrapper around the highlighted block', async () => {
    const html = renderReadmeMarkdown('```ts:src/index.ts\nexport const x = 1;\n```\n');
    const highlighted = await highlightReadmeHtml(html);

    expect(highlighted).toContain('class="code-block-wrapper"');
    expect(highlighted).toContain('class="code-block-header"');
    expect(highlighted).toContain('<span>src/index.ts</span>');
    expect(highlighted).toContain('class="shiki shiki-themes github-light github-dark"');
  });

  it('unescapes code content before highlighting and never emits raw HTML from code', async () => {
    const html = renderReadmeMarkdown('```html\n<script>alert("x")</script>\n```\n');
    const highlighted = await highlightReadmeHtml(html);

    // Shiki re-escapes the code; no executable markup may survive.
    expect(highlighted).not.toContain('<script>');
    expect(highlighted).not.toContain('</script>');
    expect(highlighted).toContain('class="shiki');
    expect(highlighted).toContain('alert');
  });

  it('leaves non-code content and HTML without code blocks untouched', async () => {
    const html = renderReadmeMarkdown('# Title\n\nSome **bold** text with `inline code`.\n');
    const highlighted = await highlightReadmeHtml(html);

    expect(highlighted).toBe(html);
  });
});

describe('renderHighlightedReadmeMarkdown', () => {
  it('returns highlighted HTML for markdown input', async () => {
    const highlighted = await renderHighlightedReadmeMarkdown('```py\nprint("hi")\n```\n');

    expect(highlighted).toContain('class="shiki shiki-themes github-light github-dark"');
    expect(highlighted).toContain('print');
  });

  it('returns an empty string for empty input', async () => {
    expect(await renderHighlightedReadmeMarkdown('')).toBe('');
    expect(await renderHighlightedReadmeMarkdown(null)).toBe('');
  });
});

describe('getOrRenderHighlightedReadme', () => {
  it('renders on R2 miss and writes the derived object back via waitUntil', async () => {
    const r2 = createFakeR2();
    const waitUntil = vi.fn((promise: Promise<unknown>) => {
      void promise;
    });
    const render = vi.fn(async () => '<pre class="shiki">code</pre>');

    const html = await getOrRenderHighlightedReadme({
      r2: r2 as never,
      skillId: 'skill-1',
      readmeVersion: 123,
      waitUntil,
      render,
    });

    const expectedKey = 'derived/readme-html/v1/skill-1/123.html';
    expect(buildHighlightedReadmeR2Key('skill-1', 123)).toBe(expectedKey);
    expect(html).toBe('<pre class="shiki">code</pre>');
    expect(render).toHaveBeenCalledTimes(1);
    expect(r2.put).toHaveBeenCalledWith(
      expectedKey,
      '<pre class="shiki">code</pre>',
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'text/html; charset=utf-8' }),
      })
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(r2.store.get(expectedKey)).toBe('<pre class="shiki">code</pre>');
  });

  it('serves the R2 object on hit without rendering again', async () => {
    const key = buildHighlightedReadmeR2Key('skill-1', 123);
    const r2 = createFakeR2({ [key]: '<pre class="shiki">cached</pre>' });
    const render = vi.fn(async () => '<pre class="shiki">fresh</pre>');

    const html = await getOrRenderHighlightedReadme({
      r2: r2 as never,
      skillId: 'skill-1',
      readmeVersion: 123,
      render,
    });

    expect(html).toBe('<pre class="shiki">cached</pre>');
    expect(render).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
  });

  it('recomputes when the readme version changes', async () => {
    const r2 = createFakeR2();
    const renderV1 = vi.fn(async () => 'v1-html');
    const renderV2 = vi.fn(async () => 'v2-html');

    await getOrRenderHighlightedReadme({
      r2: r2 as never,
      skillId: 'skill-1',
      readmeVersion: 100,
      render: renderV1,
    });
    const html = await getOrRenderHighlightedReadme({
      r2: r2 as never,
      skillId: 'skill-1',
      readmeVersion: 200,
      render: renderV2,
    });

    expect(html).toBe('v2-html');
    expect(renderV2).toHaveBeenCalledTimes(1);
    expect(r2.store.has(buildHighlightedReadmeR2Key('skill-1', 100))).toBe(true);
    expect(r2.store.has(buildHighlightedReadmeR2Key('skill-1', 200))).toBe(true);
  });

  it('never touches shared storage when R2 is unavailable (private path)', async () => {
    const render = vi.fn(async () => 'private-html');

    const html = await getOrRenderHighlightedReadme({
      r2: undefined,
      skillId: 'skill-private',
      readmeVersion: 1,
      render,
    });

    expect(html).toBe('private-html');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('exposes a per-skill R2 prefix for delete-time invalidation', () => {
    expect(buildHighlightedReadmeR2Prefix('skill-1')).toBe('derived/readme-html/v1/skill-1/');
  });
});
