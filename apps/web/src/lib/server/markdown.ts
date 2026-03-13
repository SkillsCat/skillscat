import { marked } from 'marked';
import {
  escapeAttr,
  escapeHtml,
  isRelativeMarkdownLink,
  normalizeRelativeFilePath,
  sanitizeImageSrc,
  sanitizeMarkdownHref,
  sanitizeRenderedHtml,
} from '$lib/markdown/sanitize';

const FENCE_EXTENSION_TO_LANG: Record<string, string> = {
  // JavaScript variants
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  // TypeScript variants
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  // Rust
  rs: 'rust',
  // Go
  go: 'go',
  // Shell/Bash
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  // PowerShell
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  // Windows batch/cmd
  bat: 'bat',
  cmd: 'bat',
  // Config files
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  json: 'json',
  jsonc: 'json',
  // Markup
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  // Styles
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  // Other languages
  sql: 'sql',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  rb: 'ruby',
  php: 'php',
  svelte: 'svelte',
  vue: 'vue',
  dockerfile: 'dockerfile',
};

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
}

function normalizeLanguage(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9+.#_-]/g, '');
  return normalized || 'plaintext';
}

function resolveFenceLang(lang?: string): { language: string; filename: string } {
  const language = (lang || '').trim();
  if (!language) {
    return { language: 'plaintext', filename: '' };
  }

  if (language.includes(':')) {
    const [rawLang, ...rest] = language.split(':');
    return {
      language: normalizeLanguage(rawLang || 'plaintext'),
      filename: rest.join(':').trim(),
    };
  }

  if (language.includes('.')) {
    const ext = language.split('.').pop()?.toLowerCase() || '';
    return {
      language: normalizeLanguage(FENCE_EXTENSION_TO_LANG[ext] || ext || 'plaintext'),
      filename: language.trim(),
    };
  }

  return {
    language: normalizeLanguage(language),
    filename: '',
  };
}

function createSafeMarkdownRenderer() {
  const renderer = new marked.Renderer();

  renderer.link = function ({ href, text }: { href: string; text: string }) {
    if (!href) return escapeHtml(String(text ?? ''));

    if (isRelativeMarkdownLink(href)) {
      const safePath = normalizeRelativeFilePath(href);
      const safeText = escapeHtml(String(text ?? ''));
      return `<a href="#" class="file-link" data-file-path="${escapeAttr(safePath)}">${safeText}</a>`;
    }

    const safeHref = sanitizeMarkdownHref(href);
    const safeText = escapeHtml(String(text ?? ''));
    if (!safeHref) {
      return safeText;
    }

    if (safeHref.startsWith('#') || safeHref.startsWith('/')) {
      return `<a href="${escapeAttr(safeHref)}">${safeText}</a>`;
    }

    return `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer nofollow">${safeText}</a>`;
  };

  renderer.image = ({ href, text, title }: { href?: string; text?: string; title?: string | null }) => {
    const safeSrc = sanitizeImageSrc(String(href ?? ''));
    if (!safeSrc) return '';

    const alt = escapeAttr(String(text ?? ''));
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    return `<img src="${escapeAttr(safeSrc)}" alt="${alt}" loading="lazy"${titleAttr}>`;
  };

  renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
    const { language, filename } = resolveFenceLang(lang);
    const codeHtml = `<pre><code class="language-${escapeAttr(language)}" data-language="${escapeAttr(language)}">${escapeHtml(text)}</code></pre>`;
    if (!filename) return codeHtml;
    return `<div class="code-block-wrapper"><div class="code-block-header"><span>${escapeHtml(filename)}</span></div>${codeHtml}</div>`;
  };

  return renderer;
}

export function renderReadmeMarkdown(markdown: string | null | undefined): string {
  if (!markdown) return '';
  const stripped = stripFrontmatter(markdown);
  const rendered = marked.parse(stripped, {
    renderer: createSafeMarkdownRenderer(),
    gfm: true,
    breaks: true,
    async: false,
  }) as string;
  return sanitizeRenderedHtml(rendered);
}
