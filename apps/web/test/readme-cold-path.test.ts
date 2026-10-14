import { describe, expect, it, vi } from 'vitest';
import { getPublicReadmeHtml } from '../src/lib/server/skill/highlighted-readme';
import { highlightReadmeHtml } from '../src/lib/server/text/highlight';
vi.mock('../src/lib/server/text/highlight', () => ({ highlightReadmeHtml: vi.fn() }));

describe('public README cold path', () => {
  it('returns sanitized complete Markdown while highlighting is blocked, then reuses R2 HTML', async () => {
    let finish!: (html: string) => void;
    vi.mocked(highlightReadmeHtml).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let stored: string | null = null;
    const r2 = {
      get: vi.fn(async () => stored ? { text: async () => stored } : null),
      put: vi.fn(async (_key: string, html: string) => { stored = html; }),
    };
    const tasks: Promise<unknown>[] = [];
    const loadMarkdown = vi.fn(async () => '# Complete instructions\n\n```js\nconst a = 1;\n```\n\n<script>alert(1)</script>');
    const options = { r2: r2 as never, skillId: 'one', readmeVersion: 'hash', waitUntil: (task: Promise<unknown>) => { tasks.push(task); }, loadMarkdown };
    const first = await getPublicReadmeHtml(options);
    expect(first.highlighted).toBe(false);
    expect(first.html).toContain('Complete instructions');
    expect(first.html).toContain('const a = 1;');
    expect(first.html).not.toContain('<script>');
    const concurrent = await getPublicReadmeHtml(options);
    expect(concurrent.highlighted).toBe(false);
    await vi.waitFor(() => expect(highlightReadmeHtml).toHaveBeenCalledOnce());
    finish('<h1>Complete instructions</h1><pre class="shiki">const a = 1;</pre>');
    await Promise.all(tasks);
    expect(r2.put).toHaveBeenCalledOnce();
    const next = await getPublicReadmeHtml(options);
    expect(next.highlighted).toBe(true); expect(next.html).toContain('shiki');
    expect(loadMarkdown).toHaveBeenCalledTimes(2);
  });
  it('does not start a highlighter for prose without fenced code', async () => {
    vi.mocked(highlightReadmeHtml).mockClear();
    const waitUntil = vi.fn();
    const result = await getPublicReadmeHtml({ r2: { get: async () => null } as never, skillId: 'prose', readmeVersion: 1, waitUntil, loadMarkdown: async () => '# Prose' });
    expect(result.highlighted).toBe(true); expect(result.html).toContain('Prose');
    expect(waitUntil).not.toHaveBeenCalled(); expect(highlightReadmeHtml).not.toHaveBeenCalled();
  });
  it('keeps plain HTML usable when background highlighting fails', async () => {
    vi.mocked(highlightReadmeHtml).mockRejectedValueOnce(new Error('highlighter unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const put = vi.fn();
    const tasks: Promise<unknown>[] = [];
    try {
      const result = await getPublicReadmeHtml({
        r2: { get: async () => null, put } as never, skillId: 'failure', readmeVersion: 1,
        waitUntil: (task) => { tasks.push(task); }, loadMarkdown: async () => '```js\nconst x = 1;\n```',
      });
      expect(result.html).toContain('const x = 1;');
      expect(result.highlighted).toBe(false);
      await expect(Promise.all(tasks)).resolves.toBeDefined();
      expect(put).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

});
