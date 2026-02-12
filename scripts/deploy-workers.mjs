#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const webDir = resolve(projectRoot, 'apps/web');
const ALLOWED_ENVS = new Set(['production', 'local']);
const DEFAULT_ENV = 'production';

function printUsage() {
  console.log(`
Usage:
  node scripts/deploy-workers.mjs --all [--env production|local] [--dry-run]
  node scripts/deploy-workers.mjs --worker <name> [--worker <name> ...] [--env production|local] [--dry-run]
  node scripts/deploy-workers.mjs --list [--env production|local]

Examples:
  node scripts/deploy-workers.mjs --all
  node scripts/deploy-workers.mjs --all --env local
  node scripts/deploy-workers.mjs --worker trending
  node scripts/deploy-workers.mjs --worker indexing --worker classification --env production --dry-run
`.trim());
}

function discoverWorkers() {
  return readdirSync(webDir)
    .filter((name) => name.startsWith('wrangler.') && name.endsWith('.toml'))
    .map((name) => {
      const match = /^wrangler\.(.+)\.toml$/.exec(name);
      if (!match) return null;
      const worker = match[1];
      if (worker === 'preview') return null;
      return worker;
    })
    .filter(Boolean)
    .sort();
}

function parseWorkerArg(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    all: false,
    dryRun: false,
    list: false,
    env: DEFAULT_ENV,
    workers: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      continue;
    }

    if (arg === '--all') {
      options.all = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg === '--env') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--env requires a value: production | local');
      }
      if (!ALLOWED_ENVS.has(value)) {
        throw new Error(`Invalid env "${value}". Allowed: production | local`);
      }
      options.env = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--env=')) {
      const value = arg.slice('--env='.length);
      if (!ALLOWED_ENVS.has(value)) {
        throw new Error(`Invalid env "${value}". Allowed: production | local`);
      }
      options.env = value;
      continue;
    }

    if (arg === '--worker') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--worker requires a value');
      }
      options.workers.push(...parseWorkerArg(value));
      i += 1;
      continue;
    }

    if (arg.startsWith('--worker=')) {
      const value = arg.slice('--worker='.length);
      options.workers.push(...parseWorkerArg(value));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getConfigFile(worker) {
  return `wrangler.${worker}.toml`;
}

function runDeploy(worker, env, dryRun) {
  const config = getConfigFile(worker);
  const args = ['exec', 'wrangler', 'deploy', '-c', config];
  if (env === 'production') {
    args.push('--env', 'production');
  }
  const display = `pnpm ${args.join(' ')}`;
  console.log(`[deploy:${env}:${worker}] ${display}`);

  if (dryRun) {
    return;
  }

  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const options = parseArgs(argv);
  const availableWorkers = discoverWorkers();

  if (options.list) {
    console.log(`Available workers:`);
    for (const worker of availableWorkers) {
      console.log(`- ${worker}`);
    }
    return;
  }

  const requestedWorkers = options.all
    ? availableWorkers
    : Array.from(new Set(options.workers));

  if (requestedWorkers.length === 0) {
    throw new Error('Please pass --all or at least one --worker <name>');
  }

  const invalidWorkers = requestedWorkers.filter((worker) => !availableWorkers.includes(worker));
  if (invalidWorkers.length > 0) {
    throw new Error(
      `Unknown workers: ${invalidWorkers.join(', ')}. Available: ${availableWorkers.join(', ')}`
    );
  }

  if (availableWorkers.length === 0) {
    throw new Error(
      'No worker config files found. Run init first to generate wrangler configs.'
    );
  }

  console.log(
    `Deploy target (${options.env}): ${requestedWorkers.join(', ')}${options.dryRun ? ' (dry-run)' : ''}`
  );

  for (const worker of requestedWorkers) {
    runDeploy(worker, options.env, options.dryRun);
  }
}

try {
  main();
} catch (error) {
  console.error(`[deploy-workers] ${error.message}`);
  printUsage();
  process.exit(1);
}
