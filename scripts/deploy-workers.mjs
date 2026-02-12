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
const ALLOWED_ENVS = new Set(['production', 'local']);
const DEFAULT_ENV = 'production';
const SKILLSCAT_NAME_PATTERN = /^skillscat(?:-|$)/;
const WRONG_ENV_SUFFIXES = ['-local', '-dev', '-development', '-staging', '-preview', '-test'];
const NOT_FOUND_PATTERNS = [
  /this worker does not exist/i,
  /worker does not exist/i,
  /script does not exist/i,
  /service_not_found/i,
  /code:\s*10007/i
];
const QUEUE_CONSUMER_BLOCK_PATTERNS = [
  /cannot delete this worker as it is a consumer for a queue/i,
  /remove it from the queue's consumers first/i,
  /code:\s*10064/i
];
const NO_SUCH_CONSUMER_PATTERNS = [
  /no worker consumer/i,
  /not currently a consumer/i
];
const QUEUE_ALREADY_HAS_CONSUMER_PATTERNS = [
  /already has a consumer/i,
  /code:\s*11004/i
];
const QUEUE_NOT_FOUND_PATTERNS = [
  /queue .* not found/i
];

function printUsage() {
  console.log(`
Usage:
  node scripts/deploy-workers.mjs --all [--env production|local] [--dry-run] [--yes]
                                  [--skip-wrong-env-check] [--skip-wrong-env-cleanup|--cleanup-wrong-env]
                                  [--cleanup-only] [--include-suffix-guesses]
  node scripts/deploy-workers.mjs --worker <name> [--worker <name> ...] [--env production|local]
                                  [--dry-run] [--yes]
                                  [--skip-wrong-env-check] [--skip-wrong-env-cleanup|--cleanup-wrong-env]
                                  [--cleanup-only] [--include-suffix-guesses]
  node scripts/deploy-workers.mjs --list [--env production|local]

Examples:
  node scripts/deploy-workers.mjs --all
  node scripts/deploy-workers.mjs --all --env local
  node scripts/deploy-workers.mjs --worker trending
  node scripts/deploy-workers.mjs --all --yes
  node scripts/deploy-workers.mjs --all --cleanup-only --yes
  node scripts/deploy-workers.mjs --all --cleanup-wrong-env
  node scripts/deploy-workers.mjs --all --cleanup-only --include-suffix-guesses
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
    yes: false,
    list: false,
    env: DEFAULT_ENV,
    skipWrongEnvCheck: false,
    skipWrongEnvCleanup: false,
    cleanupWrongEnv: false,
    cleanupOnly: false,
    includeSuffixGuesses: false,
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

    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
      continue;
    }

    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg === '--skip-wrong-env-check') {
      options.skipWrongEnvCheck = true;
      continue;
    }

    if (arg === '--skip-wrong-env-cleanup' || arg === '--no-cleanup') {
      options.skipWrongEnvCleanup = true;
      continue;
    }

    if (arg === '--cleanup-wrong-env') {
      options.cleanupWrongEnv = true;
      continue;
    }

    if (arg === '--cleanup-only') {
      options.cleanupOnly = true;
      continue;
    }

    if (arg === '--include-suffix-guesses') {
      options.includeSuffixGuesses = true;
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

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

function parseConfigNames(worker) {
  const configFile = getConfigFile(worker);
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

  const productionName = envNames.get('production') || topLevelName;
  if (!productionName) {
    throw new Error(`Missing worker name in ${configFile}.`);
  }

  return {
    worker,
    configFile,
    topLevelName,
    envNames,
    productionName
  };
}

function addCandidate(candidates, name, reason) {
  if (!name) return;
  const current = candidates.get(name);
  if (current) {
    current.reasons.add(reason);
    return;
  }
  candidates.set(name, { name, reasons: new Set([reason]) });
}

function stripProductionSuffix(workerName) {
  return workerName.endsWith('-production')
    ? workerName.slice(0, -'-production'.length)
    : workerName;
}

function isSkillscatWorkerName(workerName) {
  return SKILLSCAT_NAME_PATTERN.test(workerName);
}

function collectWrongEnvCandidates(workerConfigs, options = {}) {
  const productionNames = new Set(workerConfigs.map((item) => item.productionName));
  const candidates = new Map();

  for (const config of workerConfigs) {
    const legacyBaseName = stripProductionSuffix(config.productionName);

    if (config.topLevelName && config.topLevelName !== config.productionName) {
      addCandidate(
        candidates,
        config.topLevelName,
        `${config.configFile} top-level name`
      );
    }

    if (legacyBaseName && legacyBaseName !== config.productionName) {
      addCandidate(
        candidates,
        legacyBaseName,
        `${config.configFile} legacy name (without -production)`
      );
    }

    if (legacyBaseName.endsWith('-web')) {
      const rootAlias = legacyBaseName.slice(0, -'-web'.length);
      if (rootAlias) {
        addCandidate(
          candidates,
          rootAlias,
          `${config.configFile} legacy root alias`
        );
      }
    }

    for (const [envName, envWorkerName] of config.envNames.entries()) {
      if (envName === 'production') continue;
      if (!envWorkerName || envWorkerName === config.productionName) continue;
      addCandidate(
        candidates,
        envWorkerName,
        `${config.configFile} [env.${envName}].name`
      );
    }

    if (options.includeSuffixGuesses) {
      const suffixBases = new Set(
        [legacyBaseName, config.topLevelName].filter(Boolean)
      );
      for (const suffix of WRONG_ENV_SUFFIXES) {
        for (const base of suffixBases) {
          addCandidate(
            candidates,
            `${base}${suffix}`,
            `${config.worker} suffix guess (${suffix})`
          );
        }
      }
    }
  }

  const result = [];
  for (const [name, item] of candidates.entries()) {
    if (!isSkillscatWorkerName(name)) continue;
    if (productionNames.has(name)) continue;
    result.push({
      name,
      reasons: Array.from(item.reasons).sort()
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function collectSkillscatQueueNames(workerConfigs) {
  const queues = new Set();

  for (const config of workerConfigs) {
    const configPath = resolve(webDir, config.configFile);
    const content = readFileSync(configPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/g)) {
      const line = rawLine.trim();
      const queueMatch = /^queue\s*=\s*["']([^"']+)["']/.exec(line);
      if (!queueMatch) continue;
      const queueName = queueMatch[1].trim();
      if (!isSkillscatWorkerName(queueName)) continue;
      queues.add(queueName);
    }
  }

  return Array.from(queues).sort();
}

function parseQueueConsumersFromConfig(worker, env) {
  const configPath = resolve(webDir, getConfigFile(worker));
  const content = readFileSync(configPath, 'utf8');
  const targetSection = env === 'production'
    ? 'env.production.queues.consumers'
    : 'queues.consumers';
  const queues = [];
  let inTargetConsumerBlock = false;

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const arraySectionMatch = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (arraySectionMatch) {
      inTargetConsumerBlock = arraySectionMatch[1].trim() === targetSection;
      continue;
    }

    if (/^\[/.test(line)) {
      inTargetConsumerBlock = false;
      continue;
    }

    if (!inTargetConsumerBlock) continue;

    const queueMatch = /^queue\s*=\s*["']([^"']+)["']/.exec(line);
    if (!queueMatch) continue;
    queues.push(queueMatch[1].trim());
    inTargetConsumerBlock = false;
  }

  return Array.from(new Set(queues));
}

function extractFirstLine(value) {
  return value.split('\n').find((line) => line.trim()) ?? 'Unknown error';
}

function workerExists(workerName) {
  const args = ['exec', 'wrangler', 'deployments', 'list', '--name', workerName, '--json'];
  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (result.status === 0) {
    return true;
  }

  const outputText = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim();
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(outputText))) {
    return false;
  }

  const firstLine = extractFirstLine(outputText);
  throw new Error(
    `Failed to verify worker "${workerName}" existence: ${firstLine}`
  );
}

function runDeleteWorker(workerName, dryRun) {
  const args = ['exec', 'wrangler', 'delete', workerName, '--force'];
  console.log(`[cleanup] pnpm ${args.join(' ')}`);
  if (dryRun) {
    return { status: 'dry-run' };
  }

  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  const outputText = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim();
  if (result.status === 0) {
    return { status: 'deleted' };
  }

  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(outputText))) {
    return { status: 'not-found' };
  }

  if (QUEUE_CONSUMER_BLOCK_PATTERNS.some((pattern) => pattern.test(outputText))) {
    return { status: 'queue-blocked', outputText };
  }

  const firstLine = extractFirstLine(outputText);
  throw new Error(`Failed to delete worker "${workerName}": ${firstLine}`);
}

function getQueueConsumers(queueName) {
  const args = ['exec', 'wrangler', 'queues', 'info', queueName];
  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  const outputText = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim();

  if (result.status !== 0) {
    if (QUEUE_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(outputText))) {
      return [];
    }
    const firstLine = extractFirstLine(outputText);
    throw new Error(`Failed to read queue info "${queueName}": ${firstLine}`);
  }

  const line = outputText
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith('Consumers:'));

  if (!line) {
    return [];
  }

  const rawConsumers = line.replace(/^Consumers:\s*/, '').trim();
  if (!rawConsumers || rawConsumers.toLowerCase() === 'none') {
    return [];
  }

  return rawConsumers
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.startsWith('worker:') ? item.slice('worker:'.length) : item);
}

function removeQueueConsumer(queueName, workerName, dryRun) {
  const args = ['exec', 'wrangler', 'queues', 'consumer', 'remove', queueName, workerName];
  console.log(`[cleanup:queue] pnpm ${args.join(' ')}`);

  if (dryRun) {
    return;
  }

  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  const outputText = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim();
  if (result.status === 0) {
    return;
  }

  if (NO_SUCH_CONSUMER_PATTERNS.some((pattern) => pattern.test(outputText))) {
    return;
  }

  const firstLine = extractFirstLine(outputText);
  throw new Error(
    `Failed to remove queue consumer "${workerName}" from "${queueName}": ${firstLine}`
  );
}

function addQueueConsumer(queueName, workerName, dryRun) {
  const args = ['exec', 'wrangler', 'queues', 'consumer', 'add', queueName, workerName];
  console.log(`[cleanup:queue] pnpm ${args.join(' ')}`);

  if (dryRun) {
    return;
  }

  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  const outputText = stripAnsi(`${result.stdout ?? ''}\n${result.stderr ?? ''}`).trim();
  if (result.status === 0) {
    return;
  }

  if (QUEUE_ALREADY_HAS_CONSUMER_PATTERNS.some((pattern) => pattern.test(outputText))) {
    const consumers = getQueueConsumers(queueName);
    if (consumers.includes(workerName)) {
      return;
    }
  }

  const firstLine = extractFirstLine(outputText);
  throw new Error(
    `Failed to add queue consumer "${workerName}" to "${queueName}": ${firstLine}`
  );
}

function ensureQueueConsumerBinding(queueName, workerName, dryRun) {
  if (!isSkillscatWorkerName(queueName)) {
    throw new Error(`Refusing to manage non-skillscat queue: ${queueName}`);
  }
  if (!isSkillscatWorkerName(workerName)) {
    throw new Error(`Refusing to manage non-skillscat worker as consumer: ${workerName}`);
  }

  if (dryRun) {
    console.log(`[deploy:queue] Would ensure ${workerName} is consumer of ${queueName}`);
    return;
  }

  const consumers = getQueueConsumers(queueName);
  if (consumers.includes(workerName)) {
    console.log(`[deploy:queue] Queue ${queueName} already bound to ${workerName}`);
    return;
  }

  const nonSkillscatConsumers = consumers.filter((name) => !isSkillscatWorkerName(name));
  if (nonSkillscatConsumers.length > 0) {
    throw new Error(
      `Queue ${queueName} has non-skillscat consumer(s): ${nonSkillscatConsumers.join(', ')}`
    );
  }

  for (const consumer of consumers) {
    removeQueueConsumer(queueName, consumer, false);
  }
  addQueueConsumer(queueName, workerName, false);
}

function detachWorkerFromQueues(workerName, queueNames, dryRun) {
  let detached = false;

  for (const queueName of queueNames) {
    const consumers = dryRun ? [] : getQueueConsumers(queueName);
    if (!dryRun && !consumers.includes(workerName)) {
      continue;
    }

    removeQueueConsumer(queueName, workerName, dryRun);
    detached = true;
  }

  return detached;
}

function runCleanup(workerName, dryRun, queueNames) {
  if (!isSkillscatWorkerName(workerName)) {
    throw new Error(
      `Refusing to delete non-skillscat worker: ${workerName}`
    );
  }

  const firstAttempt = runDeleteWorker(workerName, dryRun);
  if (firstAttempt.status === 'dry-run') {
    return;
  }
  if (firstAttempt.status === 'deleted') {
    console.log(`[cleanup] Deleted worker: ${workerName}`);
    return;
  }
  if (firstAttempt.status === 'not-found') {
    console.log(`[cleanup] Worker not found (skip): ${workerName}`);
    return;
  }

  if (firstAttempt.status !== 'queue-blocked') {
    throw new Error(`Unexpected cleanup status for ${workerName}: ${firstAttempt.status}`);
  }

  console.log(`[cleanup] ${workerName} is attached as a queue consumer, detaching first...`);
  const detached = detachWorkerFromQueues(workerName, queueNames, dryRun);
  if (!detached) {
    throw new Error(
      `Worker ${workerName} is queue-blocked but no matching skillscat queue consumer was found to detach.`
    );
  }

  const retry = runDeleteWorker(workerName, dryRun);
  if (retry.status === 'deleted' || retry.status === 'not-found') {
    console.log(`[cleanup] Deleted worker after queue detach: ${workerName}`);
    return;
  }
  if (retry.status === 'queue-blocked') {
    throw new Error(
      `Worker ${workerName} is still queue-blocked after detach.`
    );
  }
  throw new Error(`Unexpected cleanup status for ${workerName}: ${retry.status}`);
}

function syncQueueConsumersForWorker(worker, env, dryRun) {
  if (env !== 'production') {
    return;
  }

  const parsed = parseConfigNames(worker);
  const productionWorkerName = parsed.productionName;
  const queueConsumers = parseQueueConsumersFromConfig(worker, env)
    .filter((queueName) => isSkillscatWorkerName(queueName));

  if (queueConsumers.length === 0) {
    return;
  }

  console.log(`[deploy:queue] Ensure ${productionWorkerName} consumer bindings: ${queueConsumers.join(', ')}`);
  for (const queueName of queueConsumers) {
    ensureQueueConsumerBinding(queueName, productionWorkerName, dryRun);
  }
}

async function confirmCleanup(options) {
  if (options.yes || options.dryRun) {
    return true;
  }

  if (!input.isTTY) {
    throw new Error(
      'Wrong-env workers detected in non-interactive mode. Use --yes to auto-clean or --skip-wrong-env-cleanup to continue without cleaning.'
    );
  }

  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question('Delete these wrong-env workers before deploy? [y/N]: ')).trim().toLowerCase();
    return answer.startsWith('y');
  } finally {
    rl.close();
  }
}

async function runProductionPreflight(requestedWorkers, options) {
  if (options.env !== 'production') {
    return;
  }

  if (options.skipWrongEnvCheck) {
    console.log('[preflight] Skipping wrong-env worker check (--skip-wrong-env-check).');
    return;
  }

  console.log('[preflight] Enforcing worker deploy env: production (--env production).');
  console.log('[preflight] Checking if wrong-env worker names already exist (web + workers)...');

  const preflightWorkers = [...requestedWorkers];
  const previewConfigPath = resolve(webDir, getConfigFile('preview'));
  if (existsSync(previewConfigPath) && !preflightWorkers.includes('preview')) {
    preflightWorkers.push('preview');
  }

  const workerConfigs = preflightWorkers.map((worker) => parseConfigNames(worker));
  const nonSkillscatProductionWorkers = workerConfigs
    .filter((config) => !isSkillscatWorkerName(config.productionName))
    .map((config) => `${config.configFile} -> ${config.productionName}`);

  if (nonSkillscatProductionWorkers.length > 0) {
    throw new Error(
      `Unsafe production worker names detected (must start with "skillscat"): ${nonSkillscatProductionWorkers.join(', ')}`
    );
  }

  const candidates = collectWrongEnvCandidates(workerConfigs, {
    includeSuffixGuesses: options.includeSuffixGuesses
  });

  if (candidates.length === 0) {
    console.log('[preflight] No wrong-env candidate names detected from wrangler configs.');
    return;
  }

  const queueNames = collectSkillscatQueueNames(workerConfigs);

  console.log(`[preflight] Wrong-env cleanup candidates (${candidates.length}):`);
  for (const candidate of candidates) {
    console.log(`- ${candidate.name}`);
    for (const reason of candidate.reasons) {
      console.log(`  reason: ${reason}`);
    }
  }

  if (!options.includeSuffixGuesses) {
    console.log('[preflight] Suffix guesses are disabled by default for speed. Use --include-suffix-guesses to expand scan.');
  }

  if (options.dryRun) {
    console.log('[preflight] Checking remote existing wrong-env workers (dry-run)...');
  } else {
    console.log('[preflight] Checking remote existing wrong-env workers...');
  }

  const existingWrongEnvWorkers = [];
  for (const candidate of candidates) {
    if (workerExists(candidate.name)) {
      existingWrongEnvWorkers.push(candidate);
    }
  }

  if (existingWrongEnvWorkers.length === 0) {
    console.log('[preflight] No wrong-env workers found on Cloudflare.');
    return;
  }

  console.log(`[preflight] Existing wrong-env workers (${existingWrongEnvWorkers.length}):`);
  for (const candidate of existingWrongEnvWorkers) {
    console.log(`- ${candidate.name}`);
  }

  if (options.skipWrongEnvCleanup) {
    if (!options.cleanupOnly) {
      console.log('[preflight] Deploy default: cleanup disabled. Use --cleanup-wrong-env or run pnpm cleanup:workers.');
    }
    console.log('[preflight] Skip cleanup enabled (--skip-wrong-env-cleanup).');
    return;
  }

  if (!options.dryRun) {
    const shouldCleanup = await confirmCleanup(options);
    if (!shouldCleanup) {
      throw new Error('Wrong-env workers detected. Cleanup was cancelled.');
    }
  }

  for (const candidate of existingWrongEnvWorkers) {
    runCleanup(candidate.name, options.dryRun, queueNames);
  }
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
    syncQueueConsumersForWorker(worker, env, true);
    return;
  }

  const result = spawnSync('pnpm', args, {
    cwd: webDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  syncQueueConsumersForWorker(worker, env, dryRun);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const options = parseArgs(argv);
  if (options.cleanupWrongEnv && options.skipWrongEnvCleanup) {
    throw new Error('Cannot use --cleanup-wrong-env with --skip-wrong-env-cleanup');
  }

  // Deploy defaults to check-only; cleanup is opt-in.
  if (!options.cleanupOnly && !options.cleanupWrongEnv) {
    options.skipWrongEnvCleanup = true;
  }

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

  if (!options.cleanupOnly && requestedWorkers.length === 0) {
    throw new Error('Please pass --all or at least one --worker <name>');
  }

  if (options.cleanupOnly && requestedWorkers.length === 0) {
    requestedWorkers.push(...availableWorkers);
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

  if (options.cleanupOnly && options.env !== 'production') {
    throw new Error('--cleanup-only currently supports only --env production');
  }

  await runProductionPreflight(requestedWorkers, options);

  if (options.cleanupOnly) {
    console.log('[cleanup-only] Completed wrong-env worker check/cleanup.');
    return;
  }

  for (const worker of requestedWorkers) {
    runDeploy(worker, options.env, options.dryRun);
  }
}

main().catch((error) => {
  console.error(`[deploy-workers] ${error.message}`);
  printUsage();
  process.exit(1);
});
