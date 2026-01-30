#!/usr/bin/env node

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 生成版本号 (时间戳)
const version = Date.now().toString(36);

async function build() {
  try {
    await esbuild.build({
      entryPoints: [join(rootDir, 'src/service-worker/sw.ts')],
      outfile: join(rootDir, 'static/sw.js'),
      bundle: true,
      minify: true,
      sourcemap: false,
      target: ['es2020'],
      format: 'esm',
      define: {
        '__SW_VERSION__': JSON.stringify(version),
      },
    });

    console.log(`[build-sw] Service Worker built successfully (version: ${version})`);
  } catch (error) {
    console.error('[build-sw] Build failed:', error);
    process.exit(1);
  }
}

build();
