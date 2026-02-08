<script lang="ts">
  /**
   * MarkdownRenderer - Markdown 渲染组件
   * 使用 marked 渲染 markdown 内容
   */
  import { marked } from 'marked';

  interface Props {
    content: string;
    class?: string;
  }

  let { content, class: className = '' }: Props = $props();

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value: string): string {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function sanitizeHref(rawHref: string): string | null {
    const href = rawHref.trim();
    if (!href) return null;

    if (/^(javascript|data|vbscript|file):/i.test(href)) return null;
    if (href.startsWith('//')) return null;

    if (href.startsWith('#')) return href;
    if (/^mailto:/i.test(href)) return href;
    if (/^tel:/i.test(href)) return href;
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return href;

    // Allow bare relative paths like docs/intro.md
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;

    return null;
  }

  function sanitizeImageSrc(rawSrc: string): string | null {
    const src = rawSrc.trim();
    if (!src) return null;

    if (/^(javascript|data|vbscript|file):/i.test(src)) return null;
    if (src.startsWith('//')) return null;

    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith('/') || src.startsWith('./') || src.startsWith('../')) return src;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;

    return null;
  }

  function createSafeRenderer() {
    const renderer = new marked.Renderer();

    renderer.link = ({ href, text, title }: { href?: string; text?: string; title?: string | null }) => {
      const safeText = escapeHtml(String(text ?? ''));
      const safeHref = sanitizeHref(String(href ?? ''));
      if (!safeHref) {
        return safeText;
      }

      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      const hrefAttr = ` href="${escapeAttr(safeHref)}"`;
      const external = /^https?:\/\//i.test(safeHref) || /^mailto:/i.test(safeHref);
      const externalAttrs = external ? ' target="_blank" rel="noopener noreferrer nofollow"' : '';
      return `<a${hrefAttr}${titleAttr}${externalAttrs}>${safeText}</a>`;
    };

    renderer.image = ({ href, text, title }: { href?: string; text?: string; title?: string | null }) => {
      const safeSrc = sanitizeImageSrc(String(href ?? ''));
      if (!safeSrc) {
        return '';
      }
      const alt = escapeAttr(String(text ?? ''));
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      return `<img src="${escapeAttr(safeSrc)}" alt="${alt}" loading="lazy"${titleAttr} />`;
    };

    renderer.html = (token: unknown) => {
      if (typeof token === 'string') {
        return escapeHtml(token);
      }
      if (token && typeof token === 'object') {
        const candidate = (token as { raw?: unknown; text?: unknown }).raw ?? (token as { text?: unknown }).text;
        return escapeHtml(String(candidate ?? ''));
      }
      return '';
    };

    return renderer;
  }

  const html = $derived(
    marked.parse(content, {
      gfm: true,
      breaks: true,
      renderer: createSafeRenderer(),
      async: false,
    }) as string
  );
</script>

<div class="markdown-body {className}">
  {@html html}
</div>

<style>
  .markdown-body {
    color: var(--foreground);
    line-height: 1.7;
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: 1.3;
    color: var(--foreground);
  }

  .markdown-body :global(h1) {
    font-size: 1.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .markdown-body :global(h2) {
    font-size: 1.5rem;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid var(--border);
  }

  .markdown-body :global(h3) {
    font-size: 1.25rem;
  }

  .markdown-body :global(h4) {
    font-size: 1.125rem;
  }

  .markdown-body :global(p) {
    margin-top: 0;
    margin-bottom: 1em;
  }

  .markdown-body :global(a) {
    color: var(--primary);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(ul) {
    margin-top: 0;
    margin-bottom: 1em;
    padding-left: 2em;
    list-style-type: disc;
  }

  .markdown-body :global(ol) {
    margin-top: 0;
    margin-bottom: 1em;
    padding-left: 2em;
    list-style-type: decimal;
  }

  .markdown-body :global(li) {
    margin-bottom: 0.25em;
  }

  .markdown-body :global(li > ul),
  .markdown-body :global(li > ol) {
    margin-top: 0.25em;
    margin-bottom: 0;
  }

  .markdown-body :global(blockquote) {
    margin: 1em 0;
    padding: 0.5em 1em;
    border-left: 4px solid var(--primary);
    background-color: var(--card);
    color: var(--muted-foreground);
  }

  .markdown-body :global(blockquote > p:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(code) {
    padding: 0.2em 0.4em;
    font-size: 0.875em;
    font-family: var(--font-mono, ui-monospace, monospace);
    background-color: var(--card);
    border-radius: 0.25rem;
  }

  .markdown-body :global(pre) {
    margin: 1em 0;
    padding: 1em;
    overflow-x: auto;
    font-size: 0.875rem;
    line-height: 1.5;
    background-color: var(--card);
    border-radius: 0.5rem;
  }

  .markdown-body :global(pre code) {
    padding: 0;
    background-color: transparent;
    border-radius: 0;
  }

  .markdown-body :global(table) {
    width: 100%;
    margin: 1em 0;
    border-collapse: collapse;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    padding: 0.5em 1em;
    border: 1px solid var(--border);
  }

  .markdown-body :global(th) {
    font-weight: 600;
    background-color: var(--card);
  }

  .markdown-body :global(tr:nth-child(even)) {
    background-color: var(--card);
  }

  .markdown-body :global(hr) {
    margin: 2em 0;
    border: none;
    border-top: 1px solid var(--border);
  }

  .markdown-body :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.5rem;
  }

  .markdown-body :global(strong) {
    font-weight: 600;
  }

  .markdown-body :global(em) {
    font-style: italic;
  }

  .markdown-body :global(del) {
    text-decoration: line-through;
  }

  /* Task lists */
  .markdown-body :global(input[type="checkbox"]) {
    margin-right: 0.5em;
  }
</style>
