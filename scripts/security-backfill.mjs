#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT_DIR, 'apps/web');

const DEFAULTS = {
  dbName: 'skillscat-db',
  configPath: resolve(WEB_DIR, 'wrangler.preview.toml'),
  envName: null,
  local: true,
  dryRun: false,
  scanBatchSize: 200,
  applyBatchSize: 100,
  limit: 0,
  verbose: false,
};

const TEXT_ENCODER = new TextEncoder();
const INSTRUCTION_FILES = new Set(['skill.md']);
const DOC_FILES = new Set(['readme', 'readme.md', 'license', 'license.md', 'changelog', 'changelog.md']);
const CONFIG_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml']);
const SCRIPT_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd']);
const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h',
  'hpp', 'php', 'lua', 'pl', 'r', 'scala'
]);

function printHelp() {
  console.log(`
Backfill missing security fingerprints/state for existing skills.

This script repairs rows that already have enough local metadata to derive a
security content fingerprint. It does not fetch GitHub content itself.

Usage:
  node scripts/security-backfill.mjs [options]

Options:
  --db <name>             D1 database name (default: skillscat-db)
  --config <path>         Wrangler config path (default: apps/web/wrangler.preview.toml)
  --env <name>            Wrangler environment name (example: production)
  --local                 Run against local D1 (default)
  --remote                Run against remote D1
  --dry-run               Show summary without writing changes
  --scan-batch <n>        Rows fetched per scan query (default: 200)
  --apply-batch <n>       Rows written per SQL batch (default: 100)
  --limit <n>             Stop after scanning n candidate rows
  --verbose               Print per-batch details
  -h, --help              Show this help

Examples:
  pnpm security:backfill -- --dry-run
  pnpm security:backfill -- --remote --apply-batch 50
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--db':
        options.dbName = takeArgValue(argv, index, arg);
        index += 1;
        break;
      case '--config':
        options.configPath = resolve(process.cwd(), takeArgValue(argv, index, arg));
        index += 1;
        break;
      case '--env':
        options.envName = takeArgValue(argv, index, arg);
        index += 1;
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
        options.scanBatchSize = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--apply-batch':
        options.applyBatchSize = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--limit':
        options.limit = parsePositiveInt(takeArgValue(argv, index, arg), arg);
        index += 1;
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

function parseWranglerJson(output) {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed[0]?.results || [];
    }
  } catch {
    // Ignore parse failures and fall through to an empty result set.
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

function escSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function fileName(path) {
  const parts = String(path || '').split('/');
  return (parts[parts.length - 1] || '').toLowerCase();
}

function extension(path) {
  const name = fileName(path);
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
}

function classifySecurityFileKind(path, type) {
  if (type === 'binary') {
    return 'binary';
  }

  const lowerName = fileName(path);
  const ext = extension(path);

  if (INSTRUCTION_FILES.has(lowerName)) {
    return 'instruction';
  }

  if (DOC_FILES.has(lowerName) || lowerName.endsWith('.md')) {
    return 'doc';
  }

  if (CONFIG_EXTENSIONS.has(ext) || lowerName.startsWith('.env')) {
    return 'config';
  }

  if (SCRIPT_EXTENSIONS.has(ext)) {
    return 'script';
  }

  if (CODE_EXTENSIONS.has(ext)) {
    return 'code';
  }

  return 'doc';
}

function toSecuritySource(row) {
  if (row.fileStructure) {
    try {
      const parsed = JSON.parse(row.fileStructure);
      if (Array.isArray(parsed?.files) && parsed.files.length > 0) {
        return parsed.files
          .filter((file) => file && typeof file.path === 'string' && file.path.length > 0)
          .map((file) => ({
            path: file.path,
            sha: typeof file.sha === 'string' ? file.sha : '',
            size: Number(file.size || 0),
            type: file.type === 'binary' ? 'binary' : 'text',
          }));
      }
    } catch {
      // Fall through to the readme fallback below.
    }
  }

  if (row.readme) {
    return [{
      path: 'SKILL.md',
      sha: '',
      size: TEXT_ENCODER.encode(String(row.readme)).byteLength,
      type: 'text',
    }];
  }

  return [];
}

async function buildSecurityContentFingerprint(files) {
  const normalized = files
    .map((file) => ({
      path: file.path,
      sha: file.sha || '',
      size: Number(file.size || 0),
      type: file.type,
      kind: classifySecurityFileKind(file.path, file.type),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const digest = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(JSON.stringify(normalized)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function buildUpsertSql(batch) {
  const now = Date.now();

  return batch.map((entry) => `
INSERT INTO skill_security_state (
  skill_id,
  content_fingerprint,
  dirty,
  next_update_at,
  status,
  fail_count,
  last_error,
  last_error_at,
  created_at,
  updated_at
)
VALUES (
  ${escSql(entry.skillId)},
  ${escSql(entry.contentFingerprint)},
  1,
  ${now},
  'pending',
  0,
  NULL,
  NULL,
  ${now},
  ${now}
)
ON CONFLICT(skill_id) DO UPDATE SET
  content_fingerprint = excluded.content_fingerprint,
  dirty = 1,
  next_update_at = excluded.next_update_at,
  status = excluded.status,
  current_total_score = NULL,
  current_risk_level = NULL,
  current_free_scan_id = NULL,
  current_premium_scan_id = NULL,
  premium_due_reason = NULL,
  premium_requested_at = NULL,
  premium_requested_fingerprint = NULL,
  premium_last_analyzed_fingerprint = NULL,
  vt_eligibility = 'unknown',
  vt_priority = 0,
  vt_bundle_sha256 = NULL,
  vt_bundle_size = NULL,
  vt_status = 'pending',
  vt_analysis_id = NULL,
  vt_last_stats = NULL,
  vt_next_attempt_at = NULL,
  vt_last_attempt_at = NULL,
  vt_last_submitted_at = NULL,
  vt_last_completed_at = NULL,
  fail_count = 0,
  last_error = NULL,
  last_error_at = NULL,
  updated_at = excluded.updated_at;
`.trim()).join('\n');
}

function flushPending(pending, options) {
  if (pending.length === 0 || options.dryRun) {
    return;
  }

  const sql = buildUpsertSql(pending);
  runD1(sql, options, false);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log(
    `[security-backfill] mode=${options.local ? 'local' : 'remote'} dryRun=${options.dryRun} db=${options.dbName}`
  );

  let lastRowId = 0;
  let scanned = 0;
  let repaired = 0;
  let unrecoverable = 0;
  let githubNeedsReindex = 0;
  let uploadMissingSource = 0;
  const pending = [];
  const repairedSamples = [];
  const missingSourceSamples = [];

  while (true) {
    if (options.limit > 0 && scanned >= options.limit) {
      break;
    }

    const scanLimit = options.limit > 0
      ? Math.min(options.scanBatchSize, options.limit - scanned)
      : options.scanBatchSize;

    const rows = runD1(`
      SELECT
        s.rowid AS rowid,
        s.id,
        s.slug,
        s.source_type AS sourceType,
        s.file_structure AS fileStructure,
        s.readme
      FROM skills s
      LEFT JOIN skill_security_state ss ON ss.skill_id = s.id
      WHERE s.rowid > ${lastRowId}
        AND (
          ss.skill_id IS NULL
          OR ss.content_fingerprint IS NULL
        )
      ORDER BY s.rowid
      LIMIT ${scanLimit};
    `, options, true);

    if (!rows || rows.length === 0) {
      break;
    }

    for (const row of rows) {
      scanned += 1;
      lastRowId = Math.max(lastRowId, Number(row.rowid) || 0);

      const files = toSecuritySource(row);
      if (files.length === 0) {
        unrecoverable += 1;
        if (row.sourceType === 'github') {
          githubNeedsReindex += 1;
        } else {
          uploadMissingSource += 1;
        }

        if (missingSourceSamples.length < 20) {
          missingSourceSamples.push({
            skillId: row.id,
            slug: row.slug,
            sourceType: row.sourceType,
          });
        }
        continue;
      }

      const contentFingerprint = await buildSecurityContentFingerprint(files);
      repaired += 1;
      pending.push({
        skillId: row.id,
        slug: row.slug,
        contentFingerprint,
      });

      if (repairedSamples.length < 20) {
        repairedSamples.push({
          skillId: row.id,
          slug: row.slug,
          contentFingerprint,
        });
      }

      if (pending.length >= options.applyBatchSize) {
        flushPending(pending, options);
        if (options.verbose) {
          console.log(`[security-backfill] applied batch: ${pending.length}`);
        }
        pending.length = 0;
      }
    }
  }

  flushPending(pending, options);

  console.log(`[security-backfill] scanned=${scanned}`);
  console.log(`[security-backfill] repaired=${repaired}`);
  console.log(`[security-backfill] unrecoverable=${unrecoverable}`);
  console.log(`[security-backfill] github_needs_reindex=${githubNeedsReindex}`);
  console.log(`[security-backfill] upload_missing_source=${uploadMissingSource}`);

  if (repairedSamples.length > 0) {
    console.log('[security-backfill] repaired samples:');
    for (const sample of repairedSamples) {
      console.log(`  - ${sample.slug} (${sample.skillId}) -> ${sample.contentFingerprint}`);
    }
  }

  if (missingSourceSamples.length > 0) {
    console.log('[security-backfill] missing source samples:');
    for (const sample of missingSourceSamples) {
      console.log(`  - ${sample.slug} (${sample.skillId}) [${sample.sourceType}]`);
    }
  }

  if (githubNeedsReindex > 0) {
    console.log('[security-backfill] note: github rows without file_structure/readme need indexing recovery; the security-analysis worker backfill will requeue them after deployment.');
  }

  console.log(options.dryRun ? 'Dry run complete.' : 'Security backfill complete.');
}

main().catch((error) => {
  console.error('[security-backfill] failed:', error);
  process.exit(1);
});
