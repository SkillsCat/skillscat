// Local CPU comparison only: these numbers are not Cloudflare billing metrics.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(webRoot, '../..');
const baseline = process.argv[2] || 'HEAD';
// Keep external package resolution inside this workspace, and clean only this
// script's temporary directory on completion.
const cacheRoot = path.join(webRoot, 'node_modules/.cache');
mkdirSync(cacheRoot, { recursive: true });
const temporary = mkdtempSync(path.join(cacheRoot, 'worker-cpu-'));

async function loadModule(relativePath, version) {
  const absolutePath = path.join(webRoot, relativePath);
  const outfile = path.join(temporary, `${version}-${path.basename(relativePath)}.mjs`);
  const options = {
    bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile,
    alias: { $lib: path.join(webRoot, 'src/lib') },
  };
  if (version === 'baseline') {
    const contents = execFileSync('git', ['show', `${baseline}:apps/web/${relativePath}`], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    });
    options.stdin = { contents, resolveDir: path.dirname(absolutePath), sourcefile: relativePath, loader: 'ts' };
  } else {
    options.entryPoints = [absolutePath];
  }
  await build(options);
  return import(pathToFileURL(outfile).href);
}

async function compare(before, after, iterations) {
  for (let index = 0; index < 10; index++) { await before(); await after(); }
  const samples = { before: [], after: [] };
  for (let round = 0; round < 5; round++) {
    const order = round % 2 ? ['after', 'before'] : ['before', 'after'];
    for (const name of order) {
      const operation = name === 'before' ? before : after;
      const start = process.cpuUsage();
      for (let index = 0; index < iterations; index++) await operation();
      const cpu = process.cpuUsage(start);
      samples[name].push((cpu.user + cpu.system) / 1000 / iterations);
    }
  }
  const median = (values) => values.toSorted((a, b) => a - b)[2];
  return {
    iterationsPerRound: iterations,
    beforeCpuMs: median(samples.before), afterCpuMs: median(samples.after),
    reductionPercent: 100 * (1 - median(samples.after) / median(samples.before)),
    samples,
  };
}

try {
  const modules = {};
  for (const [name, source] of Object.entries({
    auth: 'src/lib/server/auth/index.ts',
    zip: 'workers/shared/security/bundle.ts',
    hashes: 'src/lib/server/skill/dedup.ts',
  })) {
    modules[name] = { before: await loadModule(source, 'baseline'), after: await loadModule(source, 'working') };
  }
  const env = {
    DB: {}, BETTER_AUTH_SECRET: 'local-benchmark-only-secret-01234567890123456789',
    GITHUB_CLIENT_ID: 'benchmark', GITHUB_CLIENT_SECRET: 'benchmark', PUBLIC_APP_URL: 'https://skills.cat',
  };
  const session = (module) => async () => {
    const result = await module.createAuth(env).api.getSession({ headers: new Headers() });
    if (result !== null) throw new Error('Unexpected benchmark session');
  };
  const files = [{ path: 'SKILL.md', bytes: Uint8Array.from({ length: 4 * 1024 * 1024 }, (_, index) => index * 31 % 256) }];
  if (Buffer.compare(modules.zip.before.buildStoredZip(files), modules.zip.after.buildStoredZip(files)) !== 0) {
    throw new Error('ZIP output changed');
  }
  const manifest = Array.from({ length: 1000 }, (_, index) => ({
    path: index === 0 ? 'skill.md' : `src/${999 - index}/file.ts`, sha: `sha${index}`, size: index * 10, type: 'text',
  }));
  const beforeHashes = async () => ({
    bundleExactHash: await modules.hashes.before.computeExactBundleFingerprint(manifest),
    bundleManifestHash: await modules.hashes.before.computeBundleManifestHash(manifest, 'normalized'),
  });
  const afterHashes = () => modules.hashes.after.computeBundleHashes(manifest, 'normalized');
  if (JSON.stringify(await beforeHashes()) !== JSON.stringify(await afterHashes())) throw new Error('Bundle hashes changed');
  const results = {
    measuredAt: new Date().toISOString(), runtime: process.version, architecture: process.arch, baseline,
    measurement: 'Local Node process CPU, median of 5 warm rounds; excludes network and Cloudflare runtime. Synthetic bounded inputs.',
    authEmptySession: await compare(session(modules.auth.before), session(modules.auth.after), 100),
    storedZip4MiB: await compare(() => modules.zip.before.buildStoredZip(files), () => modules.zip.after.buildStoredZip(files), 20),
    bundleHashes1000Files: await compare(beforeHashes, afterHashes, 100),
  };
  console.log(JSON.stringify(results, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
