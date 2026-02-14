import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(scriptDir, '..', '.svelte-kit', 'cloudflare');
const assetsIgnorePath = resolve(assetsDir, '.assetsignore');
const requiredEntries = ['_worker.js', '_routes.json'];

await mkdir(assetsDir, { recursive: true });

let current = '';
try {
  current = await readFile(assetsIgnorePath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const existingEntries = new Set(
  current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);

const missing = requiredEntries.filter((entry) => !existingEntries.has(entry));

if (missing.length === 0) {
  console.log(`.assetsignore is up to date at ${assetsIgnorePath}`);
  process.exit(0);
}

const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
const next = `${current}${separator}${missing.join('\n')}\n`;
await writeFile(assetsIgnorePath, next, 'utf8');

console.log(`Updated .assetsignore at ${assetsIgnorePath}`);
