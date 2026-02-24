#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile, writeFile } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Generate a build version (timestamp encoded in base36)
const version = Date.now().toString(36);

async function build() {
  try {
    const outfile = join(rootDir, 'static/sw.js');

    await esbuild.build({
      entryPoints: [join(rootDir, 'src/service-worker/sw.ts')],
      outfile,
      bundle: true,
      minify: true,
      sourcemap: false,
      target: ['es2020'],
      format: 'esm',
      define: {
        '__SW_VERSION__': JSON.stringify(version),
      },
    });

    // `define` does not replace string literal placeholders, so patch the built file.
    // This keeps cache version names changing across SW builds.
    const builtContent = await readFile(outfile, 'utf8');
    await writeFile(outfile, builtContent.replaceAll('__SW_VERSION__', version), 'utf8');

    console.log(`[build-sw] Service Worker built successfully (version: ${version})`);
  } catch (error) {
    console.error('[build-sw] Build failed:', error);
    process.exit(1);
  }
}

build();
