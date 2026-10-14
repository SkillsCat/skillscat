import { renderReadmeMarkdown } from '$lib/server/text/markdown';
import type { DbEnv } from '$lib/server/db/shared/types';

/**
 * Highlighted README HTML is a derived object: the source of truth is the
 * SKILL.md markdown (D1 column or R2 source object). Public skills cache the
 * highlighted HTML in R2 so edge colos can reuse the CPU-heavy shiki result
 * for a skill version. Concurrent misses can still render independently.
 *
 * Keys embed the source content hash (or immutable upload version), so a skill
 * content update produces a new key and old objects become unreachable —
 * the same immutability model as the previous `readme:html:` Cache API
 * entries. The R2 prefix is deleted when the skill itself is deleted
 * (see lib/server/skill/delete.ts). Bump HIGHLIGHTED_README_R2_VERSION when
 * the highlighter config (themes, languages, shiki version) changes.
 */

export const HIGHLIGHTED_README_R2_VERSION = 'v1';

export function buildHighlightedReadmeR2Prefix(skillId: string): string {
  return `derived/readme-html/${HIGHLIGHTED_README_R2_VERSION}/${skillId}/`;
}

export function buildHighlightedReadmeR2Key(skillId: string, readmeVersion: string | number): string {
  return `${buildHighlightedReadmeR2Prefix(skillId)}${readmeVersion}.html`;
}

interface GetOrRenderHighlightedReadmeOptions {
  r2: DbEnv['R2'];
  skillId: string;
  readmeVersion: string | number;
  waitUntil?: (promise: Promise<unknown>) => void;
  render: () => Promise<string>;
}

/**
 * Read-through cache for highlighted README HTML: R2 hit returns the stored
 * object; a miss renders (markdown -> sanitized HTML -> shiki) and schedules
 * the R2 write via waitUntil so it never blocks the response path.
 */
export async function getOrRenderHighlightedReadme(
  options: GetOrRenderHighlightedReadmeOptions
): Promise<string> {
  const { r2, skillId, readmeVersion, waitUntil, render } = options;
  const key = buildHighlightedReadmeR2Key(skillId, readmeVersion);

  if (r2) {
    try {
      const cached = await r2.get(key);
      if (cached) {
        return await cached.text();
      }
    } catch (error) {
      console.warn(`Failed to read highlighted readme from R2 (${key}):`, error);
    }
  }

  const html = await render();

  if (r2 && html) {
    const write = r2
      .put(key, html, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn(`Failed to write highlighted readme to R2 (${key}):`, error);
      });

    if (waitUntil) {
      waitUntil(write);
    } else {
      await write;
    }
  }

  return html;
}

const pendingHighlights = new WeakMap<object, Map<string, Promise<void>>>();

/** Cold public pages render complete, sanitized Markdown without waiting for Shiki.
 * Highlighting fills the existing versioned R2 object for later requests.
 */
export async function getPublicReadmeHtml(options: {
  r2: DbEnv['R2'];
  skillId: string;
  readmeVersion: string | number;
  waitUntil?: (promise: Promise<unknown>) => void;
  loadMarkdown: () => Promise<string | null>;
}): Promise<{ html: string; highlighted: boolean }> {
  const { r2, waitUntil } = options;
  const key = buildHighlightedReadmeR2Key(options.skillId, options.readmeVersion);
  if (r2) {
    try {
      const cached = await r2.get(key);
      if (cached) return { html: await cached.text(), highlighted: true };
    } catch { /* Fall back to the source, never to an empty document. */ }
  }
  const markdown = await options.loadMarkdown();
  const plain = renderReadmeMarkdown(markdown);
  if (!plain || !plain.includes('<pre><code')) return { html: plain, highlighted: true };

  const render = async () => {
    const { highlightReadmeHtml } = await import('$lib/server/text/highlight');
    return highlightReadmeHtml(plain);
  };
  if (!r2 || !waitUntil) {
    // Without a durable destination/lifetime there is no useful deferred job.
    try { return { html: await render(), highlighted: true }; }
    catch { return { html: plain, highlighted: false }; }
  }
  let jobs = pendingHighlights.get(r2);
  if (!jobs) {
    jobs = new Map();
    pendingHighlights.set(r2, jobs);
  }
  const pending = jobs.get(key) ?? Promise.resolve().then(async () => {
    const html = await render();
    await r2.put(key, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  }).catch((error: unknown) => {
    console.warn('Background README highlighting failed:', error);
  }).finally(() => { jobs.delete(key); });
  jobs.set(key, pending);
  waitUntil(pending);
  return { html: plain, highlighted: false };
}
