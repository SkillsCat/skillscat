import { marked } from 'marked';

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

function normalizeRelativeFilePath(path: string): string {
  return path.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function isRelativeMarkdownLink(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^mailto:/i.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

function sanitizeMarkdownHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;

  if (/^(javascript|data|vbscript|file):/i.test(href)) return null;
  if (href.startsWith('//')) return null;

  if (href.startsWith('#')) return href;
  if (/^mailto:/i.test(href) || /^tel:/i.test(href)) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return href;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;

  return null;
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
  return marked.parse(stripped, {
    renderer: createSafeMarkdownRenderer(),
    gfm: true,
    breaks: true,
    async: false,
  }) as string;
}
