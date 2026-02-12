#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INITIAL_VERSION = '0.1.0';
const ALLOWED_BUMPS = new Set(['major', 'minor', 'patch']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const rootPackagePath = resolve(projectRoot, 'package.json');
const cliPackagePath = resolve(projectRoot, 'apps/cli/package.json');
const cliDir = resolve(projectRoot, 'apps/cli');

function printUsage() {
  console.log(`
Usage:
  node scripts/cli-release.mjs build [--skip-test]
  node scripts/cli-release.mjs publish [--bump major|minor|patch] [--skip-test] [--dry-run]

Examples:
  node scripts/cli-release.mjs build
  node scripts/cli-release.mjs publish
  node scripts/cli-release.mjs publish --bump patch
  node scripts/cli-release.mjs publish --bump minor --dry-run
`.trim());
}

function parseArgs(argv) {
  const options = {
    skipTest: false,
    dryRun: false,
    bump: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      continue;
    }

    if (arg === '--skip-test') {
      options.skipTest = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--bump') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--bump requires a value: major | minor | patch');
      }
      if (!ALLOWED_BUMPS.has(value)) {
        throw new Error(`Invalid bump type "${value}". Allowed: major | minor | patch`);
      }
      options.bump = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--bump=')) {
      const value = arg.slice('--bump='.length);
      if (!ALLOWED_BUMPS.has(value)) {
        throw new Error(`Invalid bump type "${value}". Allowed: major | minor | patch`);
      }
      options.bump = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpVersion(version, bumpType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (bumpType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function runStep(label, command, args, cwd = projectRoot, dryRun = false) {
  const display = `${command} ${args.join(' ')}`;
  console.log(`[${label}] ${display}`);

  if (dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function maybeBumpVersion(options) {
  const rootPkg = readJson(rootPackagePath);
  const cliPkg = readJson(cliPackagePath);

  const rootVersion = rootPkg.version ?? INITIAL_VERSION;
  const cliVersion = cliPkg.version ?? INITIAL_VERSION;

  if (rootVersion !== cliVersion) {
    throw new Error(
      `Version mismatch detected. root=${rootVersion}, apps/cli=${cliVersion}. Please sync first.`
    );
  }

  const currentVersion = cliVersion;
  const nextVersion = options.bump ? bumpVersion(currentVersion, options.bump) : currentVersion;

  console.log(`CLI version: ${currentVersion}${nextVersion !== currentVersion ? ` -> ${nextVersion}` : ''}`);

  if (!options.bump) {
    return currentVersion;
  }

  if (options.dryRun) {
    console.log('[version] Dry-run enabled, package.json files are not updated.');
    return nextVersion;
  }

  rootPkg.version = nextVersion;
  cliPkg.version = nextVersion;
  writeJson(rootPackagePath, rootPkg);
  writeJson(cliPackagePath, cliPkg);
  console.log(`[version] Updated root and apps/cli to ${nextVersion}`);

  return nextVersion;
}

function runBuild(options) {
  if (!options.skipTest) {
    runStep('test', 'pnpm', ['--filter', './apps/cli', 'test'], projectRoot, options.dryRun);
  }

  runStep('build', 'pnpm', ['--filter', './apps/cli', 'build'], projectRoot, options.dryRun);
}

function runPublish(options) {
  maybeBumpVersion(options);
  runBuild(options);
  runStep('publish', 'npm', ['publish', '--access', 'public'], cliDir, options.dryRun);
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const options = parseArgs(argv.slice(1));

  if (command === 'build') {
    runBuild(options);
    return;
  }

  if (command === 'publish') {
    runPublish(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`[cli-release] ${error.message}`);
  printUsage();
  process.exit(1);
}
