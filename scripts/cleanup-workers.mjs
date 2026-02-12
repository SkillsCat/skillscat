#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

function printUsage() {
  console.log(`
Usage:
  node scripts/cleanup-workers.mjs [--dry-run] [--yes]
                                   [--skip-wrong-env-cleanup|--check-only]

Examples:
  node scripts/cleanup-workers.mjs --dry-run
  node scripts/cleanup-workers.mjs --yes
`.trim());
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    yes: false,
    skipWrongEnvCleanup: false
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
    if (arg === '--skip-wrong-env-cleanup' || arg === '--check-only') {
      options.skipWrongEnvCleanup = true;
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

function run(options) {
  const args = ['scripts/deploy-workers.mjs', '--all', '--env', 'production', '--cleanup-only'];
  if (options.dryRun) {
    args.push('--dry-run');
  }
  if (options.yes) {
    args.push('--yes');
  }
  if (options.skipWrongEnvCleanup) {
    args.push('--skip-wrong-env-cleanup');
  }

  console.log(`[cleanup-workers] node ${args.join(' ')}`);

  const result = spawnSync('node', args, {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  run(options);
} catch (error) {
  console.error(`[cleanup-workers] ${error.message}`);
  printUsage();
  process.exit(1);
}
