// Renders sample variants of the dynamic /og image design into tmp/og-preview/
// for visual review. Usage: npx tsx scripts/og-preview.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { buildOgSvg, type OgSvgInput } from '../src/lib/seo/og-svg';

const require = createRequire(import.meta.url);
const { Resvg } = require('@cf-wasm/resvg');

const here = dirname(fileURLToPath(import.meta.url));
// The esbuild-bundled copy lives in node_modules/.cache, so allow an override.
const webRoot = process.env.OG_PREVIEW_WEB_ROOT ?? join(here, '..');
const fontCacheDir = join(webRoot, 'node_modules/.cache/og-fonts');
const outDir = join(webRoot, '../../tmp/og-preview');

const TTF_UA =
  'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';

async function loadTtf(cssUrl: string, cacheFile: string): Promise<Uint8Array> {
  const cachePath = join(fontCacheDir, cacheFile);
  if (existsSync(cachePath)) return readFile(cachePath);
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': TTF_UA } })).text();
  const match = css.match(/src:[^;]*url\(([^)]+)\)/);
  if (!match) throw new Error(`No font URL in ${cssUrl}`);
  const bytes = new Uint8Array(await (await fetch(match[1])).arrayBuffer());
  await mkdir(fontCacheDir, { recursive: true });
  await writeFile(cachePath, bytes);
  return bytes;
}

const fonts = await Promise.all([
  loadTtf('https://fonts.googleapis.com/css?family=Poppins:700', 'poppins-700.ttf'),
  loadTtf('https://fonts.googleapis.com/css?family=Poppins:800', 'poppins-800.ttf'),
  loadTtf('https://fonts.googleapis.com/css?family=JetBrains+Mono:700', 'jetbrains-mono-700.ttf'),
]);

const logoData = await readFile(join(webRoot, 'static/favicon-128x128.png'));
const logo = `data:image/png;base64,${logoData.toString('base64')}`;

const variants: Array<[string, OgSvgInput]> = [
  ['skill', {
    title: 'PDF Wizard',
    subtitle: 'Merge, split, and convert PDF documents with a single agent command.',
    tag: 'Productivity',
    author: 'backrunner',
    stars: 4200,
    installCommand: 'npx skillscat add pdf-wizard',
    showSubtitle: true,
    logo,
    avatar: logo,
  }],
  ['skill-long-command', {
    title: 'Nested Repo Skill With A Very Long Name',
    subtitle: 'A skill discovered inside a nested path of a multi-skill repository, with a fairly long description that wraps to two lines.',
    tag: 'Developer Tools',
    author: 'some-org',
    stars: 42,
    installCommand: 'npx skillscat add some-org/monorepo --skill "tools/nested/skill-name"',
    showSubtitle: true,
    logo,
    avatar: logo,
  }],
  ['user', {
    title: 'Backrunner',
    subtitle: "View Backrunner's public AI agent skills on SkillsCat.",
    tag: 'Profile',
    author: 'Backrunner',
    stars: 12800,
    installCommand: '',
    showSubtitle: true,
    logo,
    avatar: logo,
  }],
  ['page', {
    title: 'Trending Skills',
    subtitle: 'An open platform for discovering, sharing, and installing AI agent skills.',
    tag: 'Trending',
    author: '',
    stars: 0,
    installCommand: '',
    showSubtitle: true,
    logo,
    avatar: null,
  }],
];

await mkdir(outDir, { recursive: true });
for (const [name, input] of variants) {
  const svg = buildOgSvg(input);
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontBuffers: fonts, defaultFontFamily: 'Poppins' },
  });
  await writeFile(join(outDir, `${name}.png`), resvg.render().asPng());
  console.log(`Rendered ${name}.png`);
}
console.log(`Output: ${outDir}`);
