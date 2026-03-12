<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children?: Snippet;
  }

  let { title, children }: Props = $props();
</script>

<div class="card skill-content-card">
  <div class="skill-content-header">
    <svg class="skill-content-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"
      />
    </svg>
    <span class="skill-content-title">{title}</span>
  </div>
  <div class="skill-content-divider"></div>
  <article class="prose-readme">
    {@render children?.()}
  </article>
</div>

<style>
  .skill-content-card {
    padding: 2rem;
    border-radius: 1.75rem;
  }

  .skill-content-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .skill-content-icon {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--primary);
    flex-shrink: 0;
  }

  .skill-content-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--fg);
    font-family: var(--font-mono);
  }

  .skill-content-divider {
    height: 2px;
    background: linear-gradient(90deg, var(--primary) 0%, transparent 100%);
    margin-bottom: 1.5rem;
    border-radius: 1px;
  }

  .prose-readme {
    color: var(--fg);
    font-size: 0.9375rem;
    line-height: 1.7;
    padding: 0.5rem;
  }

  .prose-readme :global(> *:first-child) {
    margin-top: 0;
  }

  .prose-readme :global(> *:last-child) {
    margin-bottom: 0;
  }

  .prose-readme :global(h1),
  .prose-readme :global(h2),
  .prose-readme :global(h3),
  .prose-readme :global(h4),
  .prose-readme :global(h5),
  .prose-readme :global(h6) {
    color: var(--fg);
    font-weight: 600;
    margin-top: 1.75em;
    margin-bottom: 0.75em;
    line-height: 1.3;
  }

  .prose-readme :global(h1) {
    font-size: 1.5rem;
  }

  .prose-readme :global(h2) {
    font-size: 1.25rem;
  }

  .prose-readme :global(h3) {
    font-size: 1.125rem;
  }

  .prose-readme :global(p) {
    margin-bottom: 1.25em;
  }

  .prose-readme :global(a) {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .prose-readme :global(a:hover) {
    color: var(--primary-hover);
  }

  .prose-readme :global(code) {
    background: var(--bg-emphasis);
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85em;
    border: 1px solid var(--border);
  }

  .prose-readme :global(pre) {
    background: var(--bg-emphasis);
    padding: 1rem 1.25rem;
    border-radius: 1.25rem;
    overflow-x: auto;
    margin: 1.5em 0;
    border: 1px solid var(--border);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .prose-readme :global(pre::-webkit-scrollbar) {
    height: 6px;
  }

  .prose-readme :global(pre::-webkit-scrollbar-track) {
    background: transparent;
  }

  .prose-readme :global(pre::-webkit-scrollbar-thumb) {
    background: var(--border);
    border-radius: 3px;
  }

  .prose-readme :global(pre::-webkit-scrollbar-thumb:hover) {
    background: var(--fg-muted);
  }

  .prose-readme :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
    line-height: 1.7;
    border: none;
  }

  .prose-readme :global(.shiki) {
    padding: 1rem 1.25rem;
    border-radius: 1.25rem;
    overflow-x: auto;
    margin: 1.5em 0;
    border: 1px solid var(--border);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar) {
    height: 6px;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar-track) {
    background: transparent;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar-thumb) {
    background: var(--border);
    border-radius: 3px;
  }

  .prose-readme :global(.shiki::-webkit-scrollbar-thumb:hover) {
    background: var(--fg-muted);
  }

  .prose-readme :global(.shiki code) {
    background: transparent;
    padding: 0;
    font-size: 0.8125rem;
    line-height: 1.7;
    border: none;
  }

  .prose-readme :global(.code-block-wrapper) {
    margin: 1.5em 0;
    border-radius: 1.25rem;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .prose-readme :global(.code-block-header) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: var(--bg-muted);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-muted);
    font-weight: 500;
  }

  .prose-readme :global(.code-block-wrapper .shiki),
  .prose-readme :global(.code-block-wrapper pre) {
    margin: 0;
    border: none;
    border-radius: 0;
  }

  :root:not(.dark) .prose-readme :global(.shiki),
  :root:not(.dark) .prose-readme :global(.shiki span) {
    color: var(--shiki-light) !important;
    background-color: var(--shiki-light-bg) !important;
  }

  :root.dark .prose-readme :global(.shiki) {
    background-color: #0d1117 !important;
  }

  :root.dark .prose-readme :global(.shiki span) {
    color: var(--shiki-dark) !important;
  }

  .prose-readme :global(ul) {
    margin: 1em 0;
    padding-left: 1.5em;
    list-style-type: disc;
  }

  .prose-readme :global(ol) {
    margin: 1em 0;
    padding-left: 1.5em;
    list-style-type: decimal;
  }

  .prose-readme :global(li) {
    margin-bottom: 0.5em;
  }

  .prose-readme :global(blockquote) {
    border-left: 4px solid var(--primary);
    padding-left: 1rem;
    margin: 1em 0;
    color: var(--fg-muted);
    font-style: italic;
  }

  .prose-readme :global(hr) {
    border: none;
    border-top: 2px solid var(--border);
    margin: 2em 0;
  }

  .prose-readme :global(table) {
    display: block;
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .prose-readme :global(th),
  .prose-readme :global(td) {
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    text-align: left;
    vertical-align: top;
  }

  .prose-readme :global(th) {
    background: var(--bg-subtle);
    font-weight: 600;
  }

  .prose-readme :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 1.25rem;
    margin: 1em 0;
  }

  @media (max-width: 640px) {
    .skill-content-card {
      padding: 1.25rem;
    }

    .prose-readme {
      font-size: 0.875rem;
      padding: 0;
    }

    .prose-readme :global(th),
    .prose-readme :global(td) {
      padding: 0.375rem 0.5rem;
      font-size: 0.8125rem;
    }
  }
</style>
