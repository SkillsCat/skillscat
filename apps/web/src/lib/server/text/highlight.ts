import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubDarkTheme from 'shiki/dist/themes/github-dark.mjs';
import githubLightTheme from 'shiki/dist/themes/github-light.mjs';
import { normalizeShikiLanguage, shikiLanguageLoaders } from '$lib/shiki-languages';
import { renderReadmeMarkdown } from '$lib/server/text/markdown';

/**
 * Server-side shiki highlighting for rendered README HTML.
 *
 * Uses the JavaScript RegExp engine (oniguruma-to-es) instead of the oniguruma
 * WASM engine so it runs on Cloudflare Workers without WASM module rules, and
 * behaves identically under vitest/Node. Output shape matches the previous
 * client-side highlighting (dual github-light/github-dark themes with
 * `--shiki-light` / `--shiki-dark` CSS variables), so the existing
 * `.prose-readme .shiki` styles keep working unchanged.
 */

// Matches the exact <pre><code> shape emitted by renderReadmeMarkdown after
// sanitization. The code content is HTML-escaped, so it can never contain a
// literal `</code>`.
const CODE_BLOCK_PATTERN = /<pre><code class="language-([^"]*)"[^>]*>([\s\S]*?)<\/code><\/pre>/g;

const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark' } as const;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();
const pendingLanguageLoads = new Map<string, Promise<void>>();

function createServerShikiHighlighter(): Promise<HighlighterCore> {
  return createHighlighterCore({
    themes: [githubDarkTheme, githubLightTheme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
}

export function getServerShikiHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createServerShikiHighlighter().catch((error: unknown) => {
      highlighterPromise = null;
      loadedLanguages.clear();
      pendingLanguageLoads.clear();
      throw error;
    });
  }

  return highlighterPromise;
}

async function ensureServerShikiLanguage(
  highlighter: HighlighterCore,
  requestedLanguage: string | null | undefined
): Promise<string> {
  const normalizedLanguage = normalizeShikiLanguage(requestedLanguage);
  if (normalizedLanguage === 'plaintext') {
    return normalizedLanguage;
  }

  if (loadedLanguages.has(normalizedLanguage)) {
    return normalizedLanguage;
  }

  let pendingLoad = pendingLanguageLoads.get(normalizedLanguage);
  if (!pendingLoad) {
    const loadLanguage = shikiLanguageLoaders[normalizedLanguage];
    pendingLoad = (async () => {
      const languageModule = await loadLanguage();
      await highlighter.loadLanguage(languageModule.default);
      loadedLanguages.add(normalizedLanguage);
    })().finally(() => {
      pendingLanguageLoads.delete(normalizedLanguage);
    });

    pendingLanguageLoads.set(normalizedLanguage, pendingLoad);
  }

  await pendingLoad;
  return normalizedLanguage;
}

function unescapeCodeContent(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

interface CodeBlockMatch {
  start: number;
  end: number;
  original: string;
  language: string;
  code: string;
}

/**
 * Replace sanitized `<pre><code class="language-…">` blocks with shiki HTML.
 * Blocks that fail to highlight keep their original server-rendered markup,
 * mirroring the previous client-side fallback behavior.
 */
export async function highlightReadmeHtml(html: string): Promise<string> {
  if (!html || !html.includes('<pre><code')) {
    return html;
  }

  const blocks: CodeBlockMatch[] = [];
  CODE_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_PATTERN.exec(html)) !== null) {
    blocks.push({
      start: match.index,
      end: match.index + match[0].length,
      original: match[0],
      language: normalizeShikiLanguage(match[1]),
      code: unescapeCodeContent(match[2]),
    });
  }

  if (blocks.length === 0) {
    return html;
  }

  const highlighter = await getServerShikiHighlighter();
  const languages = [...new Set(blocks.map((block) => block.language))];
  await Promise.all(languages.map((language) => ensureServerShikiLanguage(highlighter, language)));

  let output = '';
  let cursor = 0;
  for (const block of blocks) {
    output += html.slice(cursor, block.start);

    let replacement = block.original;
    try {
      replacement = highlighter.codeToHtml(block.code, {
        lang: block.language,
        themes: SHIKI_THEMES,
      });
    } catch {
      // Keep the plain <pre><code> block if highlighting fails.
    }

    output += replacement;
    cursor = block.end;
  }
  output += html.slice(cursor);

  return output;
}

/**
 * Render raw SKILL.md markdown to highlighted HTML. Falls back to the
 * unhighlighted rendered HTML when the highlighter cannot run at all.
 */
export async function renderHighlightedReadmeMarkdown(markdown: string | null | undefined): Promise<string> {
  const rendered = renderReadmeMarkdown(markdown);
  if (!rendered) {
    return '';
  }

  try {
    return await highlightReadmeHtml(rendered);
  } catch (error) {
    console.warn('Failed to highlight readme HTML, falling back to plain output:', error);
    return rendered;
  }
}
