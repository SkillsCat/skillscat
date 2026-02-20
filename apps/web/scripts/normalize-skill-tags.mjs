#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, '..');
const ROOT_DIR = resolve(WEB_DIR, '../..');

const DEFAULTS = {
  dbName: 'skillscat-db',
  configPath: resolve(WEB_DIR, 'wrangler.preview.toml'),
  envName: null,
  local: true,
  dryRun: false,
  scanBatchSize: 500,
  applyBatchSize: 200,
  verbose: false,
};

function printHelp() {
  console.log(`
Normalize existing rows in skill_tags to canonical format.

Usage:
  node apps/web/scripts/normalize-skill-tags.mjs [options]

Options:
  --db <name>             D1 database name (default: skillscat-db)
  --config <path>         Wrangler config path (default: apps/web/wrangler.preview.toml)
  --env <name>            Wrangler environment name (example: production)
  --local                 Run against local D1 (default)
  --remote                Run against remote D1
  --dry-run               Show summary without writing changes
  --scan-batch <n>        Rows fetched per scan query (default: 500)
  --apply-batch <n>       Changed rows per write transaction (default: 200)
  --verbose               Print per-batch details
  -h, --help              Show this help

Examples:
  pnpm -C apps/web tags:normalize --dry-run
  pnpm -C apps/web tags:normalize --remote --apply-batch 100
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

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--db':
        options.dbName = takeArgValue(argv, i, arg);
        i++;
        break;
      case '--config':
        options.configPath = resolve(process.cwd(), takeArgValue(argv, i, arg));
        i++;
        break;
      case '--env':
        options.envName = takeArgValue(argv, i, arg);
        i++;
        break;
      case '--local':
        options.local = true;
        break;
      case '--remote':
        options.local = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--scan-batch':
        options.scanBatchSize = parsePositiveInt(takeArgValue(argv, i, arg), arg);
        i++;
        break;
      case '--apply-batch':
        options.applyBatchSize = parsePositiveInt(takeArgValue(argv, i, arg), arg);
        i++;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function escSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseWranglerJson(output) {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed[0]?.results || [];
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function runD1(sql, options, asJson = false) {
  const args = [
    'wrangler',
    'd1',
    'execute',
    options.dbName,
    '-c',
    options.configPath,
    options.local ? '--local' : '--remote',
    '--command',
    sql,
  ];

  if (options.envName) {
    args.push('--env', options.envName);
  }

  if (asJson) {
    args.push('--json');
    const output = execFileSync('npx', args, {
      cwd: ROOT_DIR,
      env: process.env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseWranglerJson(output);
  }

  execFileSync('npx', args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: 'inherit',
  });
  return [];
}

function trimWrappingPairs(value) {
  let output = String(value ?? '').trim();
  let changed = true;

  while (changed && output.length > 1) {
    changed = false;

    if (
      (output.startsWith('"') && output.endsWith('"'))
      || (output.startsWith("'") && output.endsWith("'"))
      || (output.startsWith('`') && output.endsWith('`'))
    ) {
      output = output.slice(1, -1).trim();
      changed = true;
      continue;
    }

    const first = output[0];
    const last = output[output.length - 1];
    if (
      (first === '[' && last === ']')
      || (first === '(' && last === ')')
      || (first === '{' && last === '}')
    ) {
      output = output.slice(1, -1).trim();
      changed = true;
    }
  }

  return output;
}

function normalizeTag(rawTag) {
  let tag = trimWrappingPairs(rawTag);
  if (!tag) return '';

  tag = tag.replace(/^[-*]\s+/, '');
  tag = tag
    .replace(/^[\[\(\{]+/, '')
    .replace(/[\]\)\}]+$/, '')
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, '');

  tag = trimWrappingPairs(tag);
  tag = tag
    .replace(/^[,;:]+/, '')
    .replace(/[,;:]+$/, '')
    .trim()
    .toLowerCase();

  return tag;
}

function buildSqlForBatch(batch) {
  const lines = ['BEGIN;'];

  for (const row of batch) {
    const skillId = escSql(row.skill_id);
    const oldTag = escSql(row.tag);

    lines.push(`DELETE FROM skill_tags WHERE skill_id = ${skillId} AND tag = ${oldTag};`);

    if (row.nextTag) {
      const createdAt = Number.isFinite(Number(row.created_at)) ? Number(row.created_at) : Date.now();
      lines.push(
        `INSERT INTO skill_tags (skill_id, tag, created_at) VALUES (${skillId}, ${escSql(row.nextTag)}, ${createdAt}) ON CONFLICT(skill_id, tag) DO NOTHING;`
      );
    }
  }

  lines.push('COMMIT;');
  return lines.join('\n');
}

function flushChanges(changes, options) {
  if (changes.length === 0) return;
  if (options.dryRun) return;

  const sql = buildSqlForBatch(changes);
  runD1(sql, options, false);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log(
    `[normalize-tags] mode=${options.local ? 'local' : 'remote'} dryRun=${options.dryRun} db=${options.dbName}`
  );

  let lastRowId = 0;
  let scanned = 0;
  let changed = 0;
  let deleted = 0;
  let rewritten = 0;
  let untouched = 0;
  const samples = [];
  const pending = [];

  while (true) {
    const rows = runD1(
      `SELECT rowid, skill_id, tag, created_at FROM skill_tags WHERE rowid > ${lastRowId} ORDER BY rowid LIMIT ${options.scanBatchSize};`,
      options,
      true
    );

    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      lastRowId = Math.max(lastRowId, Number(row.rowid) || 0);

      const currentTag = String(row.tag ?? '');
      const nextTag = normalizeTag(currentTag);

      if (nextTag === currentTag) {
        untouched++;
        continue;
      }

      changed++;
      if (!nextTag) {
        deleted++;
      } else {
        rewritten++;
      }

      if (samples.length < 20) {
        samples.push({
          skillId: row.skill_id,
          from: currentTag,
          to: nextTag || '(deleted)',
        });
      }

      pending.push({
        skill_id: row.skill_id,
        tag: currentTag,
        created_at: row.created_at,
        nextTag: nextTag || null,
      });

      if (pending.length >= options.applyBatchSize) {
        flushChanges(pending, options);
        if (options.verbose) {
          console.log(`[normalize-tags] applied batch: ${pending.length}`);
        }
        pending.length = 0;
      }
    }

    if (options.verbose) {
      console.log(`[normalize-tags] scanned=${scanned}, changed=${changed}, lastRowId=${lastRowId}`);
    }
  }

  flushChanges(pending, options);

  console.log(
    `[normalize-tags] done scanned=${scanned} changed=${changed} rewritten=${rewritten} deleted=${deleted} untouched=${untouched}`
  );

  if (samples.length > 0) {
    console.log('[normalize-tags] sample changes:');
    for (const sample of samples) {
      console.log(`  ${sample.skillId}: "${sample.from}" -> "${sample.to}"`);
    }
  }
}

main().catch((error) => {
  console.error('[normalize-tags] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
