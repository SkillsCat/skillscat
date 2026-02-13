#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const webDir = resolve(projectRoot, 'apps/web');
const DEFAULT_VARS_FILE = resolve(webDir, '.dev.vars');
const ALLOWED_ENVS = new Set(['production']);
const SKILLSCAT_NAME_PATTERN = /^skillscat(?:-|$)/;
const REQUIRED_SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'WORKER_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_TOKEN'
];
const OPTIONAL_SECRET_KEYS = [
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY'
];
const ALL_SECRET_KEYS = [...REQUIRED_SECRET_KEYS, ...OPTIONAL_SECRET_KEYS];

function printUsage() {
  console.log(`
Usage:
  node scripts/reset-worker-secrets.mjs [--env production] [--dry-run] [--yes]
                                        [--from-file <path>]
                                        [--set KEY=VALUE]...
                                        [--only KEY1,KEY2...]

Examples:
  node scripts/reset-worker-secrets.mjs --dry-run
  node scripts/reset-worker-secrets.mjs --yes --from-file apps/web/.dev.vars
  SKILLSCAT_GITHUB_TOKEN=your-token node scripts/reset-worker-secrets.mjs --set GITHUB_TOKEN=$SKILLSCAT_GITHUB_TOKEN --only GITHUB_TOKEN
`.trim());
}

function parseListArg(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSetArg(value) {
  const idx = value.indexOf('=');
  if (idx <= 0) {
    throw new Error(`Invalid --set value: ${value}. Expected KEY=VALUE`);
  }
  const key = value.slice(0, idx).trim();
  const secretValue = value.slice(idx + 1);
  if (!key) {
    throw new Error(`Invalid --set value: ${value}. Missing KEY`);
  }
  return { key, value: secretValue };
}

function parseArgs(argv) {
  const options = {
    env: 'production',
    dryRun: false,
    yes: false,
    varsFile: DEFAULT_VARS_FILE,
    only: [],
    sets: new Map()
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') continue;
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
      continue;
    }
    if (arg === '--env') {
      const value = argv[i + 1];
      if (!value || !ALLOWED_ENVS.has(value)) {
        throw new Error('--env requires: production');
      }
      options.env = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      const value = arg.slice('--env='.length);
      if (!ALLOWED_ENVS.has(value)) {
        throw new Error('--env requires: production');
      }
      options.env = value;
      continue;
    }
    if (arg === '--from-file') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--from-file requires a value');
      }
      options.varsFile = resolve(projectRoot, value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--from-file=')) {
      const value = arg.slice('--from-file='.length).trim();
      if (!value) {
        throw new Error('--from-file requires a value');
      }
      options.varsFile = resolve(projectRoot, value);
      continue;
    }
    if (arg === '--only') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--only requires a value');
      }
      options.only.push(...parseListArg(value));
      i += 1;
      continue;
    }
    if (arg.startsWith('--only=')) {
      const value = arg.slice('--only='.length);
      options.only.push(...parseListArg(value));
      continue;
    }
    if (arg === '--set') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--set requires KEY=VALUE');
      }
      const parsed = parseSetArg(value);
      options.sets.set(parsed.key, parsed.value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--set=')) {
      const value = arg.slice('--set='.length);
      const parsed = parseSetArg(value);
      options.sets.set(parsed.key, parsed.value);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseVarsFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const values = {};

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1);
    if (!key) continue;
    values[key] = stripQuotes(value);
  }

  return values;
}

function discoverConfigFiles() {
  return readdirSync(webDir)
    .filter((name) => name.startsWith('wrangler.') && name.endsWith('.toml'))
    .sort();
}

function parseConfigNames(configFile) {
  const configPath = resolve(webDir, configFile);
  const content = readFileSync(configPath, 'utf8');
  const envNames = new Map();
  let section = '';
  let topLevelName = '';

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const nameMatch = /^name\s*=\s*["']([^"']+)["']/.exec(line);
    if (!nameMatch) continue;

    const workerName = nameMatch[1].trim();
    if (!section) {
      topLevelName = workerName;
      continue;
    }

    const envMatch = /^env\.([^.]+)$/.exec(section);
    if (envMatch) {
      envNames.set(envMatch[1], workerName);
    }
  }

  return {
    configFile,
    topLevelName,
    envNames
  };
}

function isSkillscatWorkerName(workerName) {
  return SKILLSCAT_NAME_PATTERN.test(workerName);
}

function discoverTargetWorkers(env) {
  const configFiles = discoverConfigFiles();
  const targets = [];
  const seen = new Set();

  for (const configFile of configFiles) {
    const parsed = parseConfigNames(configFile);
    const workerName = env === 'production'
      ? parsed.envNames.get('production')
      : parsed.topLevelName;

    if (!workerName) {
      throw new Error(`Missing worker name for env "${env}" in ${configFile}`);
    }

    if (!isSkillscatWorkerName(workerName)) {
      throw new Error(
        `Unsafe worker name in ${configFile}: ${workerName} (must start with "skillscat")`
      );
    }

    if (seen.has(workerName)) continue;
    seen.add(workerName);
    targets.push(workerName);
  }

  return targets.sort();
}

function isPlaceholderValue(value) {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('your-')) return true;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return true;
  if (trimmed === 'changeme') return true;
  return false;
}

function resolveSelectedKeys(options) {
  if (options.only.length === 0) {
    return [...ALL_SECRET_KEYS];
  }

  const selected = Array.from(new Set(options.only));
  const invalid = selected.filter((key) => !ALL_SECRET_KEYS.includes(key));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown secret key(s): ${invalid.join(', ')}. Allowed: ${ALL_SECRET_KEYS.join(', ')}`
    );
  }
  return selected;
}

async function fillMissingRequiredSecrets(values, missingRequired, options) {
  if (missingRequired.length === 0) return;

  if (options.yes || !input.isTTY) {
    throw new Error(
      `Missing required secrets: ${missingRequired.join(', ')}. Provide via --set, shell env, or ${options.varsFile}.`
    );
  }

  console.log('Missing required secrets, please input:');
  const rl = createInterface({ input, output });
  try {
    for (const key of missingRequired) {
      const value = (await rl.question(`${key}: `)).trim();
      if (isPlaceholderValue(value)) {
        throw new Error(`Invalid value for ${key}`);
      }
      values[key] = value;
    }
  } finally {
    rl.close();
  }
}

async function resolveSecrets(options, selectedKeys) {
  const fileSecrets = parseVarsFile(options.varsFile);
  const values = {};
  const missingRequired = [];

  for (const key of selectedKeys) {
    const fromCli = options.sets.get(key);
    const fromEnv = process.env[key];
    const fromFile = fileSecrets[key];
    const value = fromCli ?? fromEnv ?? fromFile ?? '';

    if (isPlaceholderValue(value)) {
      if (REQUIRED_SECRET_KEYS.includes(key)) {
        missingRequired.push(key);
      }
      continue;
    }

    values[key] = value;
  }

  await fillMissingRequiredSecrets(values, missingRequired, options);

  const secretsToWrite = {};
  for (const key of selectedKeys) {
    const value = values[key];
    if (!isPlaceholderValue(value)) {
      secretsToWrite[key] = value;
    }
  }

  const missingAfterPrompt = selectedKeys.filter(
    (key) => REQUIRED_SECRET_KEYS.includes(key) && !secretsToWrite[key]
  );
  if (missingAfterPrompt.length > 0) {
    throw new Error(`Missing required secrets: ${missingAfterPrompt.join(', ')}`);
  }

  if (Object.keys(secretsToWrite).length === 0) {
    throw new Error('No valid secrets to set.');
  }

  return secretsToWrite;
}

function printPlan(workers, secretsToWrite, options) {
  console.log(`Target env: ${options.env}`);
  console.log(`Workers (${workers.length}): ${workers.join(', ')}`);
  console.log(`Secrets (${Object.keys(secretsToWrite).length}): ${Object.keys(secretsToWrite).join(', ')}`);
  console.log(`Source file: ${existsSync(options.varsFile) ? options.varsFile : `${options.varsFile} (not found)`}`);
  if (options.dryRun) {
    console.log('Mode: dry-run');
  }
}

async function confirmOrExit(options) {
  if (options.yes || options.dryRun) return;

  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question('Continue resetting worker secrets? [y/N]: ')).trim().toLowerCase();
    if (!answer.startsWith('y')) {
      console.log('Aborted by user.');
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

function runSecretPut(workerName, key, value, options) {
  const args = ['exec', 'wrangler', 'secret', 'put', key, '--name', workerName];
  if (options.env === 'production') {
    args.push('--env', 'production');
  }

  console.log(`[secret:${workerName}] pnpm ${args.join(' ')}`);

  if (options.dryRun) {
    return;
  }

  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: ['pipe', 'inherit', 'inherit'],
    input: `${value}\n`,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.sets.size > 0) {
    console.warn('[reset-worker-secrets] Warning: --set can leak secrets via shell history/process list. Prefer --from-file or environment variables.');
  }
  const selectedKeys = resolveSelectedKeys(options);
  const workers = discoverTargetWorkers(options.env);
  const secretsToWrite = await resolveSecrets(options, selectedKeys);

  printPlan(workers, secretsToWrite, options);
  await confirmOrExit(options);

  for (const workerName of workers) {
    for (const [key, value] of Object.entries(secretsToWrite)) {
      runSecretPut(workerName, key, value, options);
    }
  }

  console.log('Worker secrets reset completed.');
}

main().catch((error) => {
  console.error(`[reset-worker-secrets] ${error.message}`);
  printUsage();
  process.exit(1);
});
