#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT_DIR, 'apps/web');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const SUMMARY_SKILL_MD_EXCERPT_CHARS = 2000;
const SUMMARY_MAX_OUTPUT_TOKENS = 220;
const SUMMARY_MAX_STORED_CHARS = 600;
const SUMMARY_MIN_OUTPUT_CHARS = 24;

const DEFAULTS = {
  dbName: 'skillscat-db',
  configPath: resolve(WEB_DIR, 'wrangler.preview.toml'),
  envName: null,
  local: true,
  dryRun: false,
  scanBatchSize: 100,
  applyBatchSize: 50,
  limit: 0,
  model: DEFAULT_MODEL,
  requestDelayMs: 250,
  verbose: false,
};

function printHelp() {
  console.log(`
Backfill AI-generated functional summaries for existing skills.

Reads skills whose summary is empty but whose SKILL.md text is already stored
in D1 (readme column), calls OpenRouter once per skill, and writes the summary
back to skills.summary. Private skills are skipped.

Cache note: skill detail HTML/API caches use short TTLs (5 min / 300 s), so
backfilled summaries appear without an explicit purge. Skills classified after
this script runs get their summary (and an explicit cache invalidation) from
the classification worker instead.

Requires OPENROUTER_API_KEY in the environment (same key the workers use).

Usage:
  node scripts/summary-backfill.mjs [options]

Options:
  --db <name>             D1 database name (default: skillscat-db)
  --config <path>         Wrangler config path (default: apps/web/wrangler.preview.toml)
  --env <name>            Wrangler environment name (example: production)
  --local                 Run against local D1 (default)
  --remote                Run against remote D1
  --dry-run               Show what would be generated without writing changes
  --scan-batch <n>        Skills fetched per scan query (default: 100)
  --apply-batch <n>       Summaries written per SQL batch (default: 50)
  --limit <n>             Stop after scanning n skills
  --model <id>            OpenRouter model (default: ${DEFAULT_MODEL})
  --request-delay <ms>    Delay between AI calls (default: 250)
  --verbose               Print per-skill details
  -h, --help              Show this help

Examples:
  OPENROUTER_API_KEY=... pnpm summary:backfill -- --dry-run --limit 10
  OPENROUTER_API_KEY=... pnpm summary:backfill -- --remote --apply-batch 25
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

function parseNonNegativeInt(raw, flagName) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer, got: ${raw}`);
  }
  return parsed;
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
      case '--model':
        options.model = takeArgValue(argv, index, arg);
        index += 1;
        break;
      case '--request-delay':
        options.requestDelayMs = parseNonNegativeInt(takeArgValue(argv, index, arg), arg);
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

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

// Keep in sync with buildSkillSummaryPrompt in apps/web/workers/classification.ts.
function buildSummaryPrompt(readmeExcerpt, description) {
  const trimmedDescription = String(description || '').trim();

  return `You are summarizing an AI agent skill for a public software directory.
${trimmedDescription ? `\nAuthor-provided short description: ${trimmedDescription.slice(0, 300)}\n` : ''}
SKILL.md excerpt:
---
${String(readmeExcerpt || '').slice(0, SUMMARY_SKILL_MD_EXCERPT_CHARS)}
---

Write a 2-3 sentence plain-text summary in English that objectively explains:
- what this skill does
- what problem it solves
- when an agent or developer should use it

Rules:
- Objective, factual tone only: no marketing language, no superlatives, no calls to action
- Natural prose, no keyword stuffing, no bullet points, no headings, no markdown formatting
- Do not wrap the answer in quotes
- At most 60 words

Respond with ONLY the summary text.`;
}

// Keep in sync with sanitizeSkillSummary in apps/web/workers/classification.ts.
function sanitizeSummary(raw) {
  if (!raw) {
    return null;
  }

  let text = String(raw).replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();

  if (text.length < SUMMARY_MIN_OUTPUT_CHARS) {
    return null;
  }

  if (text.length > SUMMARY_MAX_STORED_CHARS) {
    const cut = text.slice(0, SUMMARY_MAX_STORED_CHARS);
    const lastSentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = lastSentenceEnd > SUMMARY_MIN_OUTPUT_CHARS ? cut.slice(0, lastSentenceEnd + 1) : cut;
  }

  return text;
}

async function callOpenRouter(prompt, options, apiKey) {
  const body = JSON.stringify({
    model: options.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
  });

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://skills.cat',
    'X-Title': 'SkillsCat Summary Backfill',
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(OPENROUTER_API_URL, { method: 'POST', headers, body });

    if (response.ok) {
      const data = await response.json();
      return data?.choices?.[0]?.message?.content || null;
    }

    if (response.status === 429 && attempt === 0) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 60_000;
      console.warn(`[summary-backfill] rate limited, waiting ${Math.round(waitMs / 1000)}s before one retry`);
      await sleep(waitMs);
      continue;
    }

    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText.slice(0, 300)}`);
  }

  return null;
}

function buildBatchSkillSql(lastRowId, scanLimit) {
  return `
    SELECT
      rowid AS rowid,
      id,
      slug,
      description,
      substr(readme, 1, ${SUMMARY_SKILL_MD_EXCERPT_CHARS}) AS readme_excerpt
    FROM skills
    WHERE (summary IS NULL OR summary = '')
      AND readme IS NOT NULL
      AND readme != ''
      AND visibility != 'private'
      AND rowid > ${lastRowId}
    ORDER BY rowid
    LIMIT ${scanLimit};
  `;
}

function buildApplySql(entries) {
  return entries
    .map((entry) => (
      `UPDATE skills SET summary = ${escSql(entry.summary)} WHERE id = ${escSql(entry.id)} AND (summary IS NULL OR summary = '');`
    ))
    .join('\n');
}

function flushPending(pending, options) {
  if (pending.length === 0 || options.dryRun) {
    return;
  }

  runD1(buildApplySql(pending), options, false);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required (use the same key as the workers)');
  }

  console.log(
    `[summary-backfill] mode=${options.local ? 'local' : 'remote'} dryRun=${options.dryRun} db=${options.dbName} model=${options.model}`
  );

  let lastRowId = 0;
  let scanned = 0;
  let generated = 0;
  let failed = 0;
  const pending = [];
  const samples = [];

  while (true) {
    if (options.limit > 0 && scanned >= options.limit) {
      break;
    }

    const scanLimit = options.limit > 0
      ? Math.min(options.scanBatchSize, options.limit - scanned)
      : options.scanBatchSize;

    const skills = runD1(buildBatchSkillSql(lastRowId, scanLimit), options, true);
    if (!skills || skills.length === 0) {
      break;
    }

    for (const skill of skills) {
      scanned += 1;
      lastRowId = Math.max(lastRowId, Number(skill.rowid) || 0);

      try {
        const raw = await callOpenRouter(
          buildSummaryPrompt(skill.readme_excerpt, skill.description),
          options,
          apiKey
        );
        const summary = sanitizeSummary(raw);

        if (!summary) {
          failed += 1;
          if (options.verbose) {
            console.warn(`[summary-backfill] unusable model output for ${skill.slug}, skipped`);
          }
          continue;
        }

        generated += 1;
        pending.push({ id: skill.id, summary });

        if (samples.length < 15) {
          samples.push({ slug: skill.slug, summary });
        }

        if (options.verbose) {
          console.log(`[summary-backfill] ${skill.slug}: ${summary}`);
        }
      } catch (error) {
        failed += 1;
        console.warn(`[summary-backfill] failed for ${skill.slug}: ${error.message}`);
      }

      if (pending.length >= options.applyBatchSize) {
        flushPending(pending, options);
        pending.length = 0;
      }

      if (options.requestDelayMs > 0) {
        await sleep(options.requestDelayMs);
      }
    }
  }

  flushPending(pending, options);

  console.log(`[summary-backfill] scanned=${scanned}`);
  console.log(`[summary-backfill] generated=${generated}`);
  console.log(`[summary-backfill] failed=${failed}`);

  if (samples.length > 0) {
    console.log('[summary-backfill] samples:');
    for (const sample of samples) {
      console.log(`  - ${sample.slug}: ${sample.summary}`);
    }
  }

  console.log(options.dryRun ? 'Dry run complete.' : 'Summary backfill complete.');
}

main().catch((error) => {
  console.error('[summary-backfill] failed:', error);
  process.exitCode = 1;
});
