import type { DbEnv } from '$lib/server/db/shared/types';

/**
 * Highlighted README HTML is a derived object: the source of truth is the
 * SKILL.md markdown (D1 column or R2 source object). Public skills cache the
 * highlighted HTML in R2 so the (CPU-heavy) shiki transform runs at most once
 * per skill version globally, instead of once per edge colo.
 *
 * Keys embed the readme version (skill.updatedAt ?? indexedAt), so a skill
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
