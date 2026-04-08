#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, '..');
const DEFAULT_BACKFILL_FREE_MODEL = 'google/gemma-4-31b-it:free';

const DEFAULTS = {
  envName: 'production',
  risks: ['high', 'fatal'],
  limit: 0,
  workerBatchSize: 10,
  requestedTier: 'free',
  freeModel: DEFAULT_BACKFILL_FREE_MODEL,
  dryRun: false,
  outputPath: '',
  inputPath: '',
};

function printHelp() {
  console.log(`
Re-run remote security analysis for production high-risk skills using the local worker code.

Usage:
  node apps/web/scripts/security-rerun-remote.mjs [options]

Options:
  --env <name>              Wrangler environment name (default: production)
  --risk <csv>              Risk levels to target (default: high,fatal)
  --limit <n>               Only process the first n matching skills
  --worker-batch <n>        Skills to re-run per scheduled trigger (max recommended: 10)
  --requested-tier <tier>   Requested tier for replayed jobs: auto|free|premium (default: free)
  --free-model <id>         Free model override for reruns (default: google/gemma-4-31b-it:free)
  --output <path>           Write a JSON snapshot of the selected skills
  --input <path>            Re-use a previously written snapshot instead of querying production
  --dry-run                 Print the selected skills but do not mutate production
  -h, --help                Show this help

Examples:
  node apps/web/scripts/security-rerun-remote.mjs --dry-run --limit 20
  node apps/web/scripts/security-rerun-remote.mjs --limit 10
`.trim());
}

function takeArgValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parsePositiveInt(raw, flagName) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

function parseRisks(raw) {
  const values = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const invalid = values.filter((value) => !['low', 'mid', 'high', 'fatal'].includes(value));
  if (invalid.length > 0) {
    throw new Error(`Unsupported risks: ${invalid.join(', ')}`);
  }
  return Array.from(new Set(values));
}

function parseRequestedTier(raw) {
  const value = String(raw).trim();
  if (!['auto', 'free', 'premium'].includes(value)) {
    throw new Error(`Unsupported requested tier: ${raw}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--env':
        options.envName = takeArgValue(argv, index, arg);
        index += 1;
        break;
      case '--risk':
        options.risks = parseRisks(takeArgValue(argv, index, arg));
        index += 1;
        break;
      case '--limit':
        options.limit = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--worker-batch':
        options.workerBatchSize = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--requested-tier':
        options.requestedTier = parseRequestedTier(takeArgValue(argv, index, arg));
        index += 1;
        break;
      case '--free-model':
        options.freeModel = takeArgValue(argv, index, arg).trim();
        index += 1;
        break;
      case '--output':
        options.outputPath = resolve(process.cwd(), takeArgValue(argv, index, arg));
        index += 1;
        break;
      case '--input':
        options.inputPath = resolve(process.cwd(), takeArgValue(argv, index, arg));
        index += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.workerBatchSize > 10) {
    throw new Error('--worker-batch must be 10 or less because the scheduled worker processes up to 10 due skills per run');
  }

  return options;
}

function applyRerunModelOverrides(env, options) {
  if (options.requestedTier !== 'free' && options.requestedTier !== 'auto') {
    return;
  }

  if (!options.freeModel) {
    return;
  }

  env.SECURITY_FREE_MODEL = options.freeModel;
  env.SECURITY_FREE_MODELS = options.freeModel;
}

function buildInClause(length) {
  return Array.from({ length }, () => '?').join(', ');
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function summarizeByRisk(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.risk, (counts.get(row.risk) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

async function queryTargets(db, options) {
  const riskPlaceholders = buildInClause(options.risks.length);
  const limitClause = options.limit > 0 ? `LIMIT ${options.limit}` : '';

  const statement = db.prepare(`
    SELECT
      s.id,
      s.slug,
      ss.current_risk_level AS risk,
      ss.current_total_score AS score,
      ss.content_fingerprint AS contentFingerprint,
      ss.current_free_scan_id AS freeScanId,
      ss.current_premium_scan_id AS premiumScanId,
      ss.last_analyzed_at AS lastAnalyzedAt
    FROM skills s
    INNER JOIN skill_security_state ss ON ss.skill_id = s.id
    WHERE ss.current_risk_level IN (${riskPlaceholders})
    ORDER BY ss.current_total_score DESC, s.slug ASC
    ${limitClause}
  `);

  const result = await statement.bind(...options.risks).all();
  return result.results || [];
}

async function loadTargets(options, db) {
  if (!options.inputPath) {
    return queryTargets(db, options);
  }

  const file = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(options.inputPath, 'utf8')));
  return Array.isArray(file?.rows) ? file.rows : [];
}

async function writeSnapshot(rows, options) {
  const outputPath = options.outputPath
    || resolve(APP_DIR, '.wrangler', 'tmp', `security-rerun-${Date.now()}.json`);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    env: options.envName,
    risks: options.risks,
    count: rows.length,
    rows,
  }, null, 2)}\n`, 'utf8');

  return outputPath;
}

async function deleteExistingScans(db, rows) {
  const withFingerprint = rows.filter((row) => row.contentFingerprint);
  for (const row of withFingerprint) {
    await db.prepare(`
      DELETE FROM skill_security_scans
      WHERE skill_id = ?
        AND content_fingerprint = ?
    `)
      .bind(row.id, row.contentFingerprint)
      .run();
  }
}

async function resetSecurityState(db, rows) {
  const now = Date.now();

  for (const row of rows) {
    await db.prepare(`
      UPDATE skill_security_state
      SET
        dirty = 1,
        next_update_at = 0,
        status = 'pending',
        last_analyzed_at = NULL,
        current_total_score = NULL,
        current_risk_level = NULL,
        current_free_scan_id = NULL,
        current_premium_scan_id = NULL,
        fail_count = 0,
        last_error = NULL,
        last_error_at = NULL,
        updated_at = ?
      WHERE skill_id = ?
    `)
      .bind(now, row.id)
      .run();
  }
}

async function readUpdatedChunk(db, rows) {
  const placeholders = buildInClause(rows.length);
  const result = await db.prepare(`
    SELECT
      s.slug,
      ss.current_risk_level AS risk,
      ss.current_total_score AS score,
      ss.last_analyzed_at AS lastAnalyzedAt
    FROM skill_security_state ss
    INNER JOIN skills s ON s.id = ss.skill_id
    WHERE ss.skill_id IN (${placeholders})
    ORDER BY s.slug ASC
  `)
    .bind(...rows.map((row) => row.id))
    .all();

  return result.results || [];
}

async function bundleSecurityWorker() {
  const outdir = resolve(APP_DIR, '.wrangler', 'tmp', `security-rerun-bundle-${Date.now()}`);
  await mkdir(outdir, { recursive: true });
  const outfile = resolve(outdir, 'security-analysis.mjs');

  await build({
    entryPoints: [resolve(APP_DIR, 'workers', 'security-analysis.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    sourcemap: false,
    logLevel: 'silent',
    define: {
      'import.meta.vitest': 'undefined',
    },
  });

  return import(pathToFileURL(outfile).href);
}

async function runChunkThroughWorker(workerModule, env, rows, requestedTier) {
  let acked = 0;
  const retried = [];

  await workerModule.default.queue({
    messages: rows.map((row) => ({
      id: row.id,
      body: {
        type: 'analyze_security',
        skillId: row.id,
        trigger: 'manual',
        requestedTier,
      },
      ack: () => {
        acked += 1;
      },
      retry: () => {
        retried.push(row.slug);
      },
    })),
  }, env, {});

  if (retried.length > 0) {
    throw new Error(`Worker retried ${retried.length} messages: ${retried.slice(0, 5).join(', ')}`);
  }
  if (acked !== rows.length) {
    throw new Error(`Expected ${rows.length} acks but saw ${acked}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log(
    `[security-rerun-remote] env=${options.envName} risks=${options.risks.join(',')} requestedTier=${options.requestedTier} freeModel=${options.freeModel} dryRun=${options.dryRun}`
  );

  const proxy = await getPlatformProxy({
    configPath: 'wrangler.security-analysis.toml',
    environment: options.envName,
  });

  let workerModule;
  try {
    applyRerunModelOverrides(proxy.env, options);

    const targets = await loadTargets(options, proxy.env.DB);
    console.log(`[security-rerun-remote] selected=${targets.length}`);
    for (const [risk, count] of summarizeByRisk(targets)) {
      console.log(`[security-rerun-remote] ${risk}=${count}`);
    }

    const snapshotPath = await writeSnapshot(targets, options);
    console.log(`[security-rerun-remote] snapshot=${snapshotPath}`);

    if (targets.length > 0) {
      console.log('[security-rerun-remote] sample slugs:');
      for (const row of targets.slice(0, 10)) {
        console.log(`  - ${row.slug} (${row.risk}, score=${row.score})`);
      }
    }

    if (options.dryRun || targets.length === 0) {
      console.log(options.dryRun ? 'Dry run complete.' : 'Nothing to process.');
      return;
    }

    workerModule = await bundleSecurityWorker();

    const chunks = chunk(targets, options.workerBatchSize);
    for (let index = 0; index < chunks.length; index += 1) {
      const currentChunk = chunks[index];
      console.log(`[security-rerun-remote] batch ${index + 1}/${chunks.length} resetting ${currentChunk.length} skills`);

      await deleteExistingScans(proxy.env.DB, currentChunk);
      await resetSecurityState(proxy.env.DB, currentChunk);

      console.log(`[security-rerun-remote] batch ${index + 1}/${chunks.length} running local worker against production bindings`);
      await runChunkThroughWorker(workerModule, proxy.env, currentChunk, options.requestedTier);

      const updated = await readUpdatedChunk(proxy.env.DB, currentChunk);
      const incomplete = updated.filter((row) => !row.risk);
      const distribution = summarizeByRisk(updated.filter((row) => row.risk));
      console.log(`[security-rerun-remote] batch ${index + 1}/${chunks.length} updated=${updated.length} incomplete=${incomplete.length}`);
      for (const [risk, count] of distribution) {
        console.log(`[security-rerun-remote] batch ${index + 1}/${chunks.length} ${risk}=${count}`);
      }

      if (incomplete.length > 0) {
        const sample = incomplete.slice(0, 5).map((row) => row.slug).join(', ');
        throw new Error(`Batch ${index + 1} did not complete for: ${sample}`);
      }
    }

    console.log('Remote security re-run complete.');
  } finally {
    await proxy.dispose?.();
  }
}

main().catch((error) => {
  console.error('[security-rerun-remote] failed:', error);
  process.exit(1);
});
