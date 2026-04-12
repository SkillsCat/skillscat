#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const INITIAL_VERSION = '0.1.0';
const DEFAULT_TAG_PREFIX = 'web/v';
const ALLOWED_BUMPS = new Set(['major', 'minor', 'patch']);
const ALLOWED_WORKER_ENVS = new Set(['production', 'local']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const webDir = resolve(projectRoot, 'apps/web');
const webPackagePath = resolve(webDir, 'package.json');

class StepError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'StepError';
    this.exitCode = exitCode;
  }
}

function printUsage() {
  console.log(`
Usage:
  node scripts/web-release.mjs build [--dry-run]
  node scripts/web-release.mjs deploy [--bump major|minor|patch] [--no-bump] [--skip-build] [--dry-run] [--yes]
                                      [--no-tag] [--tag <tag>] [--no-push-tag]
  node scripts/web-release.mjs deploy-all [--bump major|minor|patch] [--no-bump] [--skip-build] [--dry-run] [--yes]
                                          [--no-tag] [--tag <tag>] [--no-push-tag]
                                          [--workers-env production|local]

Examples:
  node scripts/web-release.mjs deploy --bump patch
  node scripts/web-release.mjs deploy --no-tag
  node scripts/web-release.mjs deploy-all --bump minor
  node scripts/web-release.mjs deploy-all --dry-run --yes
`.trim());
}

function parseArgs(argv) {
  const options = {
    bump: null,
    noBump: false,
    bumpProvided: false,
    noBumpProvided: false,
    skipBuild: false,
    dryRun: false,
    yes: false,
    noTag: false,
    tag: '',
    pushTag: true,
    workersEnv: 'production'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') continue;

    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg === '--no-bump') {
      options.bump = null;
      options.noBump = true;
      options.noBumpProvided = true;
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
      options.noBump = false;
      options.bumpProvided = true;
      i += 1;
      continue;
    }
    if (arg.startsWith('--bump=')) {
      const value = arg.slice('--bump='.length);
      if (!ALLOWED_BUMPS.has(value)) {
        throw new Error('--bump requires major | minor | patch');
      }
      options.bump = value;
      options.noBump = false;
      options.bumpProvided = true;
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
    if (arg === '--workers-env') {
      const value = argv[i + 1];
      if (!value || !ALLOWED_WORKER_ENVS.has(value)) {
        throw new Error('--workers-env requires production | local');
      }
      options.workersEnv = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--workers-env=')) {
      const value = arg.slice('--workers-env='.length);
      if (!ALLOWED_WORKER_ENVS.has(value)) {
        throw new Error('--workers-env requires production | local');
      }
      options.workersEnv = value;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.noTag && options.tag) {
    throw new Error('Cannot use --no-tag and --tag together');
  }
  if (options.bumpProvided && options.noBumpProvided) {
    throw new Error('Cannot use --bump and --no-bump together');
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

  if (result.error) {
    throw new StepError(
      `[${label}] ${display} failed: ${result.error.message}`,
      result.status ?? 1
    );
  }

  if (result.status !== 0) {
    const stderr = capture ? (result.stderr ?? '').trim() : '';
    if (stderr) {
      console.error(stderr);
    }
    throw new StepError(
      `[${label}] ${display} failed with exit code ${result.status ?? 1}`,
      result.status ?? 1
    );
  }

  return {
    status: 0,
    stdout: capture ? (result.stdout ?? '') : ''
  };
}

function getWebVersion() {
  const pkg = readJson(webPackagePath);
  return pkg.version ?? INITIAL_VERSION;
}

function ensureDefaultBump(options) {
  if (options.bump || options.noBump) {
    return;
  }

  options.bump = 'patch';
  console.log('[bump] No --bump provided, defaulting to patch.');
}

function prepareWebVersion(options) {
  const originalContent = readFileSync(webPackagePath, 'utf8');
  const pkg = JSON.parse(originalContent);
  const currentVersion = pkg.version ?? INITIAL_VERSION;
  const nextVersion = options.bump ? bumpVersion(currentVersion, options.bump) : currentVersion;
  const changed = currentVersion !== nextVersion;

  console.log(`Web version: ${currentVersion}${nextVersion !== currentVersion ? ` -> ${nextVersion}` : ''}`);

  return {
    currentVersion,
    nextVersion,
    changed,
    originalContent,
    applied: false
  };
}

function applyWebVersion(versionInfo, options) {
  if (!versionInfo.changed) {
    return;
  }

  if (options.dryRun) {
    console.log('[version] Dry-run enabled, apps/web/package.json will not be changed.');
    return;
  }

  const pkg = JSON.parse(versionInfo.originalContent);
  pkg.version = versionInfo.nextVersion;
  writeJson(webPackagePath, pkg);
  versionInfo.applied = true;
  console.log(`[version] Updated apps/web/package.json -> ${versionInfo.nextVersion}`);
}

function rollbackWebVersion(versionInfo) {
  if (!versionInfo?.applied) {
    return;
  }

  try {
    writeFileSync(webPackagePath, versionInfo.originalContent);
    versionInfo.applied = false;
    console.log(`[rollback] Restored apps/web/package.json -> ${versionInfo.currentVersion}`);
  } catch (error) {
    console.error(`[rollback] Failed to restore apps/web/package.json: ${error.message}`);
  }
}

function resolveTag(version, options) {
  if (options.noTag) return '';
  return options.tag || `${DEFAULT_TAG_PREFIX}${version}`;
}

function assertTagNotExists(tag, options) {
  if (!tag) return;

  const result = runStep('tag-check', 'git', ['tag', '-l', tag], {
    capture: true,
    dryRun: options.dryRun
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

function printPlan(mode, versionInfo, tag, options) {
  console.log(`\nRelease plan (Web: ${mode}):`);
  console.log(`- Version: ${versionInfo.currentVersion} -> ${versionInfo.nextVersion}`);
  console.log(`- Build web: ${options.skipBuild ? 'skip' : 'run'}`);
  console.log('- Deploy web: run');
  if (mode === 'deploy-all') {
    console.log(`- Deploy workers: run (env: ${options.workersEnv})`);
  }
  console.log(`- Commit version bump: ${versionInfo.changed ? 'run' : 'skip (no version change)'}`);
  console.log(`- Push branch: ${versionInfo.changed ? 'run' : 'skip (no version change)'}`);
  console.log(
    `- Tag: ${tag ? `create ${tag} (after successful deploy + git push)` : 'skip'}`
  );
  console.log(`- Push tag: ${tag ? (options.pushTag ? 'yes' : 'no') : 'n/a (no tag)'}`);
  if (options.dryRun) {
    console.log('- Mode: dry-run');
  }
}

function runWebBuild(options) {
  runStep('build:web', 'pnpm', ['--filter', '@skillscat/web', 'build'], {
    cwd: projectRoot,
    dryRun: options.dryRun
  });
}

function runWebDeploy(options) {
  runStep('deploy:web', 'pnpm', ['--filter', '@skillscat/web', 'run', 'deploy'], {
    cwd: projectRoot,
    dryRun: options.dryRun
  });
}

function runWorkersDeploy(options) {
  const args = ['scripts/deploy-workers.mjs', '--all', '--env', options.workersEnv];
  args.push('--skip-wrong-env-check');
  if (options.dryRun) {
    args.push('--dry-run');
  }
  if (options.yes) {
    args.push('--yes');
  }

  runStep('deploy:workers', 'node', args, {
    cwd: projectRoot,
    dryRun: false
  });
}

function runVersionCommitFlow(versionInfo, options) {
  if (!versionInfo.changed) {
    console.log('[git] Version unchanged, skipping commit/push.');
    return;
  }

  runStep('git:add-version', 'git', ['add', 'apps/web/package.json'], {
    cwd: projectRoot,
    dryRun: options.dryRun
  });
  runStep(
    'git:commit-version',
    'git',
    ['commit', '-m', `chore(release): web v${versionInfo.nextVersion}`, '--', 'apps/web/package.json'],
    {
      cwd: projectRoot,
      dryRun: options.dryRun
    }
  );
  runStep('git:push-branch', 'git', ['push'], {
    cwd: projectRoot,
    dryRun: options.dryRun
  });
}

function runTagFlow(tag, version, options) {
  if (!tag) return;

  runStep('tag', 'git', ['tag', '-a', tag, '-m', `web release v${version}`], {
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

async function runDeploy(command, options) {
  ensureDefaultBump(options);
  const versionInfo = prepareWebVersion(options);
  const tag = resolveTag(versionInfo.nextVersion, options);

  assertTagNotExists(tag, options);
  printPlan(command, versionInfo, tag, options);
  await confirmOrExit(
    options,
    command === 'deploy-all'
      ? 'Continue web + workers deploy'
      : 'Continue web deploy'
  );

  applyWebVersion(versionInfo, options);

  try {
    if (!options.skipBuild) {
      runWebBuild(options);
    }

    runWebDeploy(options);

    if (command === 'deploy-all') {
      runWorkersDeploy(options);
    }
  } catch (error) {
    rollbackWebVersion(versionInfo);
    throw error;
  }

  runVersionCommitFlow(versionInfo, options);
  runTagFlow(tag, versionInfo.nextVersion, options);
  console.log(`\nWeb ${command} flow completed.`);
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
    console.log(`Web version: ${getWebVersion()}`);
    runWebBuild(options);
    return;
  }

  if (command === 'deploy') {
    await runDeploy('deploy', options);
    return;
  }

  if (command === 'deploy-all') {
    await runDeploy('deploy-all', options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`[web-release] ${error.message}`);
  if (!(error instanceof StepError)) {
    printUsage();
  }
  process.exit(error.exitCode ?? 1);
});
