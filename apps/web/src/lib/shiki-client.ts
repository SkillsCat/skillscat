import type { HighlighterCore } from 'shiki/core';
import {
  normalizeShikiLanguage,
  shikiLanguageLoaders,
  type ShikiThemeRegistration,
} from '$lib/shiki-languages';

type ShikiThemeModule = { default: ShikiThemeRegistration };

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();
const pendingLanguageLoads = new Map<string, Promise<void>>();

async function createClientShikiHighlighter(): Promise<HighlighterCore> {
  const [
    { createHighlighterCore },
    { createOnigurumaEngine },
    wasmModule,
    githubDarkTheme,
    githubLightTheme,
  ] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/oniguruma'),
    import('shiki/wasm'),
    import('shiki/dist/themes/github-dark.mjs') as Promise<ShikiThemeModule>,
    import('shiki/dist/themes/github-light.mjs') as Promise<ShikiThemeModule>,
  ]);

  return await createHighlighterCore({
    themes: [githubDarkTheme.default, githubLightTheme.default],
    langs: [],
    engine: await createOnigurumaEngine(wasmModule.default ?? wasmModule),
  });
}

export async function getClientShikiHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createClientShikiHighlighter().catch((error: unknown) => {
      highlighterPromise = null;
      loadedLanguages.clear();
      pendingLanguageLoads.clear();
      throw error;
    });
  }

  return await highlighterPromise;
}

export function normalizeClientShikiLanguage(language: string | null | undefined): string {
  return normalizeShikiLanguage(language);
}

export async function ensureClientShikiLanguage(
  highlighter: HighlighterCore,
  requestedLanguage: string | null | undefined
): Promise<string> {
  const normalizedLanguage = normalizeClientShikiLanguage(requestedLanguage);
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
