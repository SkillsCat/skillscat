// Renders apps/web/static/og/home.svg -> home.png (1200x630).
// Inlines the favicon as a data URI and loads Poppins/JetBrains Mono TTFs
// (resvg cannot use the woff2 files shipped in static/fonts).
// Usage: node scripts/render-og-home.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Resvg } = require('@cf-wasm/resvg');

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const svgPath = join(webRoot, 'static/og/home.svg');
const pngPath = join(webRoot, 'static/og/home.png');
const fontCacheDir = join(webRoot, 'node_modules/.cache/og-fonts');

// Google Fonts serves TTF to old Android clients (the CSS v1 API defaults to woff2).
const TTF_UA =
  'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30';

async function loadTtf(cssUrl, cacheFile) {
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

let svg = await readFile(svgPath, 'utf8');

// Inline local image references (resvg does not resolve site-absolute paths).
for (const asset of ['favicon-128x128.png', 'favicon-512x512.png']) {
  const data = await readFile(join(webRoot, 'static', asset));
  svg = svg.replaceAll(`href="/${asset}"`, `href="data:image/png;base64,${data.toString('base64')}"`);
}

const fonts = await Promise.all([
  loadTtf('https://fonts.googleapis.com/css?family=Poppins:500', 'poppins-500.ttf'),
  loadTtf('https://fonts.googleapis.com/css?family=Poppins:600', 'poppins-600.ttf'),
  loadTtf('https://fonts.googleapis.com/css?family=Poppins:700', 'poppins-700.ttf'),
  loadTtf('https://fonts.googleapis.com/css?family=Poppins:800', 'poppins-800.ttf'),
  loadTtf('https://fonts.googleapis.com/css?family=JetBrains+Mono:700', 'jetbrains-mono-700.ttf'),
]);

const resvg = await Resvg.async(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: { fontBuffers: fonts, defaultFontFamily: 'Poppins' },
});

await writeFile(pngPath, resvg.render().asPng());
console.log(`Rendered ${pngPath}`);
