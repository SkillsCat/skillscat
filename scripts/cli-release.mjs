#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const INITIAL_VERSION = '0.1.0';
const DEFAULT_TAG_PREFIX = 'cli/v';
const ALLOWED_BUMPS = new Set(['major', 'minor', 'patch']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const cliDir = resolve(projectRoot, 'apps/cli');
const cliPackagePath = resolve(cliDir, 'package.json');

function printUsage() {
  console.log(`
Usage:
  node scripts/cli-release.mjs build [--skip-test] [--dry-run]
  node scripts/cli-release.mjs publish [--bump major|minor|patch] [--skip-test] [--dry-run] [--yes]
                                      [--no-tag] [--tag <tag>] [--no-push-tag]

Examples:
  node scripts/cli-release.mjs build
  node scripts/cli-release.mjs publish --bump patch
  node scripts/cli-release.mjs publish --bump minor --yes
  node scripts/cli-release.mjs publish --no-tag
  node scripts/cli-release.mjs publish --tag release/cli-v1.2.3 --push-tag
`.trim());
}

function parseArgs(argv) {
  const options = {
    skipTest: false,
    dryRun: false,
    bump: null,
    yes: false,
    noTag: false,
    tag: '',
    pushTag: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') continue;

    if (arg === '--skip-test') {
      options.skipTest = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
      continue;
    }
    if (arg === '--no-tag') {
      options.noTag = true;
      continue;
    }
    if (arg === '--push-tag') {
      options.pushTag = true;
      continue;
    }
    if (arg === '--no-push-tag') {
      options.pushTag = false;
      continue;
    }
    if (arg === '--bump') {
      const value = argv[i + 1];
      if (!value || !ALLOWED_BUMPS.has(value)) {
        throw new Error('--bump requires major | minor | patch');
      }
      options.bump = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--bump=')) {
      const value = arg.slice('--bump='.length);
      if (!ALLOWED_BUMPS.has(value)) {
        throw new Error('--bump requires major | minor | patch');
      }
      options.bump = value;
      continue;
    }
    if (arg === '--tag') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--tag requires a value');
      }
      options.tag = value.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--tag=')) {
      const value = arg.slice('--tag='.length).trim();
      if (!value) {
        throw new Error('--tag requires a value');
      }
      options.tag = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.noTag && options.tag) {
    throw new Error('Cannot use --no-tag and --tag together');
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

function runStep(label, command, args, options = {}) {
  const { cwd = projectRoot, dryRun = false, capture = false } = options;
  const display = `${command} ${args.join(' ')}`;
  console.log(`[${label}] ${display}`);

  if (dryRun) {
    return { status: 0, stdout: '' };
  }

  const result = spawnSync(command, args, {
    cwd,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: capture ? 'utf8' : undefined
  });

  if (result.status !== 0) {
    const stderr = capture ? (result.stderr ?? '').trim() : '';
    if (stderr) {
      console.error(stderr);
    }
    process.exit(result.status ?? 1);
  }

  return {
    status: 0,
    stdout: capture ? (result.stdout ?? '') : ''
  };
}

function getCliVersion() {
  const pkg = readJson(cliPackagePath);
  return pkg.version ?? INITIAL_VERSION;
}

function maybeBumpCliVersion(options) {
  const pkg = readJson(cliPackagePath);
  const currentVersion = pkg.version ?? INITIAL_VERSION;
  const nextVersion = options.bump ? bumpVersion(currentVersion, options.bump) : currentVersion;

  console.log(`CLI version: ${currentVersion}${nextVersion !== currentVersion ? ` -> ${nextVersion}` : ''}`);

  if (!options.bump) {
    return { currentVersion, nextVersion };
  }

  if (options.dryRun) {
    console.log('[version] Dry-run enabled, apps/cli/package.json will not be changed.');
    return { currentVersion, nextVersion };
  }

  pkg.version = nextVersion;
  writeJson(cliPackagePath, pkg);
  console.log(`[version] Updated apps/cli/package.json -> ${nextVersion}`);
  return { currentVersion, nextVersion };
}

function resolveTag(version, options) {
  if (options.noTag) return '';
  return options.tag || `${DEFAULT_TAG_PREFIX}${version}`;
}

function assertTagNotExists(tag, options) {
  if (!tag) return;

  const result = runStep('tag-check', 'git', ['tag', '-l', tag], {
    cwd: projectRoot,
    dryRun: options.dryRun,
    capture: true
  });

  if (!options.dryRun && result.stdout.trim()) {
    throw new Error(`Tag already exists: ${tag}. Use --bump or --no-tag, or pass a custom --tag.`);
  }
}

async function confirmOrExit(options, question) {
  if (options.yes || options.dryRun) return;

  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N]: `)).trim().toLowerCase();
    if (!answer.startsWith('y')) {
      console.log('Aborted by user.');
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

function printPublishPlan(versionInfo, tag, options) {
  console.log('\nRelease plan (CLI):');
  console.log(`- Version: ${versionInfo.currentVersion} -> ${versionInfo.nextVersion}`);
  console.log(`- Test: ${options.skipTest ? 'skip' : 'run'}`);
  console.log('- Build: run');
  console.log('- Publish: npm publish --access public');
  console.log(`- Tag: ${tag ? `create ${tag} (after publish)` : 'skip'}`);
  console.log(`- Push tag: ${tag ? (options.pushTag ? 'yes' : 'no') : 'n/a (no tag)'}`);
  if (options.dryRun) {
    console.log('- Mode: dry-run');
  }
}

function runBuild(options) {
  if (!options.skipTest) {
    runStep('test', 'pnpm', ['--filter', './apps/cli', 'test'], {
      cwd: projectRoot,
      dryRun: options.dryRun
    });
  }

  runStep('build', 'pnpm', ['--filter', './apps/cli', 'build'], {
    cwd: projectRoot,
    dryRun: options.dryRun
  });
}

function runTagFlow(tag, version, options) {
  if (!tag) return;

  runStep('tag', 'git', ['tag', '-a', tag, '-m', `cli release v${version}`], {
    cwd: projectRoot,
    dryRun: options.dryRun
  });

  if (options.pushTag) {
    runStep('push-tag', 'git', ['push', 'origin', tag], {
      cwd: projectRoot,
      dryRun: options.dryRun
    });
  }
}

async function runPublish(options) {
  const versionInfo = maybeBumpCliVersion(options);
  const tag = resolveTag(versionInfo.nextVersion, options);

  assertTagNotExists(tag, options);
  printPublishPlan(versionInfo, tag, options);
  await confirmOrExit(options, 'Continue CLI publish');

  runBuild(options);
  runStep('publish', 'npm', ['publish', '--access', 'public'], {
    cwd: cliDir,
    dryRun: options.dryRun
  });
  runTagFlow(tag, versionInfo.nextVersion, options);

  console.log('\nCLI publish flow completed.');
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const options = parseArgs(argv.slice(1));

  if (command === 'build') {
    console.log(`CLI version: ${getCliVersion()}`);
    runBuild(options);
    return;
  }

  if (command === 'publish') {
    await runPublish(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`[cli-release] ${error.message}`);
  printUsage();
  process.exit(1);
});
