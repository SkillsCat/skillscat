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

  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  const html = $derived(marked.parse(content) as string);
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

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin-top: 0;
    margin-bottom: 1em;
    padding-left: 2em;
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
