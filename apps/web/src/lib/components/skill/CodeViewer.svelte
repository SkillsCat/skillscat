<script lang="ts">
  /**
   * CodeViewer - 代码查看器组件
   * 使用 Shiki 进行语法高亮
   */
  import { onMount } from 'svelte';
  import { codeToHtml, type BundledLanguage } from 'shiki';

  interface Props {
    code: string;
    language?: string;
    filename?: string;
    class?: string;
  }

  let { code, language = 'text', filename = '', class: className = '' }: Props = $props();

  let highlightedCode = $state('');
  let isLoading = $state(true);

  // Map file extensions to Shiki languages
  function getLanguageFromFilename(filename: string): BundledLanguage {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, BundledLanguage> = {
      'ts': 'typescript',
      'tsx': 'tsx',
      'js': 'javascript',
      'jsx': 'jsx',
      'json': 'json',
      'md': 'markdown',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'html': 'html',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'sql': 'sql',
      'graphql': 'graphql',
      'gql': 'graphql',
      'svelte': 'svelte',
      'vue': 'vue',
      'java': 'java',
      'kt': 'kotlin',
      'swift': 'swift',
      'rb': 'ruby',
      'php': 'php',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
    };
    return langMap[ext || ''] || 'text';
  }

  const effectiveLanguage = $derived(
    language !== 'text' ? language : getLanguageFromFilename(filename)
  );

  onMount(async () => {
    try {
      highlightedCode = await codeToHtml(code, {
        lang: effectiveLanguage as BundledLanguage,
        themes: {
          light: 'github-light',
          dark: 'github-dark',
        },
      });
    } catch (error) {
      console.error('Failed to highlight code:', error);
      // Fallback to plain text
      highlightedCode = `<pre><code>${escapeHtml(code)}</code></pre>`;
    } finally {
      isLoading = false;
    }
  });

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
</script>

<div class="code-viewer {className}">
  {#if filename}
    <div class="code-header">
      <span class="code-filename">{filename}</span>
      <span class="code-language">{effectiveLanguage}</span>
    </div>
  {/if}

  <div class="code-content">
    {#if isLoading}
      <div class="code-loading">
        <pre><code>{code}</code></pre>
      </div>
    {:else}
      {@html highlightedCode}
    {/if}
  </div>
</div>

<style>
  .code-viewer {
    border-radius: 0.5rem;
    overflow: hidden;
    background-color: var(--card);
    border: 1px solid var(--border);
  }

  .code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background-color: var(--muted);
    border-bottom: 1px solid var(--border);
    font-size: 0.75rem;
  }

  .code-filename {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--foreground);
    font-weight: 500;
  }

  .code-language {
    color: var(--muted-foreground);
    text-transform: uppercase;
  }

  .code-content {
    overflow-x: auto;
  }

  .code-content :global(pre) {
    margin: 0;
    padding: 1rem;
    font-size: 0.875rem;
    line-height: 1.6;
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .code-content :global(code) {
    font-family: inherit;
  }

  .code-loading pre {
    margin: 0;
    padding: 1rem;
    font-size: 0.875rem;
    line-height: 1.6;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--foreground);
  }

  /* Shiki theme support */
  .code-content :global(.shiki) {
    background-color: transparent !important;
  }

  :global(html.dark) .code-content :global(.shiki),
  :global(html.dark) .code-content :global(.shiki span) {
    color: var(--shiki-dark) !important;
    background-color: var(--shiki-dark-bg) !important;
  }

  :global(html:not(.dark)) .code-content :global(.shiki),
  :global(html:not(.dark)) .code-content :global(.shiki span) {
    color: var(--shiki-light) !important;
    background-color: var(--shiki-light-bg) !important;
  }
</style>
