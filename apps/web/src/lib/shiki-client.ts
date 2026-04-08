import type { HighlighterCore } from 'shiki/core';

type ShikiLanguageRegistration = Parameters<HighlighterCore['loadLanguage']>[0];
type ShikiThemeRegistration = Exclude<Parameters<HighlighterCore['loadTheme']>[0], 'none'>;

type ShikiLanguageModule = { default: ShikiLanguageRegistration };
type ShikiThemeModule = { default: ShikiThemeRegistration };
type ShikiLanguageLoader = () => Promise<ShikiLanguageModule>;

const loadShellScript = () => import('shiki/dist/langs/shellscript.mjs') as Promise<ShikiLanguageModule>;
const loadJavaScript = () => import('shiki/dist/langs/javascript.mjs') as Promise<ShikiLanguageModule>;
const loadTypeScript = () => import('shiki/dist/langs/typescript.mjs') as Promise<ShikiLanguageModule>;
const loadPython = () => import('shiki/dist/langs/python.mjs') as Promise<ShikiLanguageModule>;
const loadJson = () => import('shiki/dist/langs/json.mjs') as Promise<ShikiLanguageModule>;
const loadMarkdown = () => import('shiki/dist/langs/markdown.mjs') as Promise<ShikiLanguageModule>;
const loadYaml = () => import('shiki/dist/langs/yaml.mjs') as Promise<ShikiLanguageModule>;
const loadHtml = () => import('shiki/dist/langs/html.mjs') as Promise<ShikiLanguageModule>;
const loadCss = () => import('shiki/dist/langs/css.mjs') as Promise<ShikiLanguageModule>;
const loadGo = () => import('shiki/dist/langs/go.mjs') as Promise<ShikiLanguageModule>;
const loadRust = () => import('shiki/dist/langs/rust.mjs') as Promise<ShikiLanguageModule>;
const loadPowershell = () => import('shiki/dist/langs/powershell.mjs') as Promise<ShikiLanguageModule>;
const loadBat = () => import('shiki/dist/langs/bat.mjs') as Promise<ShikiLanguageModule>;
const loadSql = () => import('shiki/dist/langs/sql.mjs') as Promise<ShikiLanguageModule>;
const loadToml = () => import('shiki/dist/langs/toml.mjs') as Promise<ShikiLanguageModule>;
const loadXml = () => import('shiki/dist/langs/xml.mjs') as Promise<ShikiLanguageModule>;
const loadJsx = () => import('shiki/dist/langs/jsx.mjs') as Promise<ShikiLanguageModule>;
const loadTsx = () => import('shiki/dist/langs/tsx.mjs') as Promise<ShikiLanguageModule>;
const loadSvelte = () => import('shiki/dist/langs/svelte.mjs') as Promise<ShikiLanguageModule>;
const loadVue = () => import('shiki/dist/langs/vue.mjs') as Promise<ShikiLanguageModule>;
const loadC = () => import('shiki/dist/langs/c.mjs') as Promise<ShikiLanguageModule>;
const loadCpp = () => import('shiki/dist/langs/cpp.mjs') as Promise<ShikiLanguageModule>;
const loadJava = () => import('shiki/dist/langs/java.mjs') as Promise<ShikiLanguageModule>;
const loadKotlin = () => import('shiki/dist/langs/kotlin.mjs') as Promise<ShikiLanguageModule>;
const loadSwift = () => import('shiki/dist/langs/swift.mjs') as Promise<ShikiLanguageModule>;
const loadRuby = () => import('shiki/dist/langs/ruby.mjs') as Promise<ShikiLanguageModule>;
const loadPhp = () => import('shiki/dist/langs/php.mjs') as Promise<ShikiLanguageModule>;
const loadDockerfile = () => import('shiki/dist/langs/dockerfile.mjs') as Promise<ShikiLanguageModule>;

const shikiLanguageLoaders: Record<string, ShikiLanguageLoader> = {
  javascript: loadJavaScript,
  typescript: loadTypeScript,
  python: loadPython,
  shellscript: loadShellScript,
  json: loadJson,
  markdown: loadMarkdown,
  yaml: loadYaml,
  html: loadHtml,
  css: loadCss,
  go: loadGo,
  rust: loadRust,
  powershell: loadPowershell,
  bat: loadBat,
  sql: loadSql,
  toml: loadToml,
  xml: loadXml,
  jsx: loadJsx,
  tsx: loadTsx,
  svelte: loadSvelte,
  vue: loadVue,
  c: loadC,
  cpp: loadCpp,
  java: loadJava,
  kotlin: loadKotlin,
  swift: loadSwift,
  ruby: loadRuby,
  php: loadPhp,
  dockerfile: loadDockerfile,
};

const shikiLanguageAliases: Record<string, string> = {
  plain: 'plaintext',
  plaintext: 'plaintext',
  text: 'plaintext',
  txt: 'plaintext',
  bash: 'shellscript',
  shell: 'shellscript',
  shellscript: 'shellscript',
  sh: 'shellscript',
  zsh: 'shellscript',
  js: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  htm: 'html',
  ps1: 'powershell',
  batch: 'bat',
  cmd: 'bat',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  cxx: 'cpp',
  cc: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  svg: 'xml',
  docker: 'dockerfile',
};

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
  const trimmed = language?.trim().toLowerCase();
  if (!trimmed) {
    return 'plaintext';
  }

  const aliased = shikiLanguageAliases[trimmed];
  if (aliased) {
    return aliased;
  }

  return trimmed in shikiLanguageLoaders ? trimmed : 'plaintext';
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
