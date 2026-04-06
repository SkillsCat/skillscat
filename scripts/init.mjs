#!/usr/bin/env node

/**
 * SkillsCat 环境初始化脚本
 *
 * 功能:
 * 1. 复制 wrangler.*.toml.example 到 wrangler.*.toml
 * 2. 创建 .dev.vars 文件并生成随机 secrets (本地模式)
 * 3. 创建 Cloudflare 资源 (D1, R2, KV, Queues)
 * 4. 更新 wrangler.toml 文件中的资源 ID
 * 5. 设置 Cloudflare secrets (生产模式)
 *
 * Usage:
 *   pnpm init:project              # 交互式初始化 (本地开发)
 *   pnpm init:project --local      # 仅本地配置 (不创建 Cloudflare 资源)
 *   pnpm init:project --production # 生产环境配置 (创建资源 + 设置 secrets)
 *   pnpm init:project --workers trending,search-precompute # 仅初始化指定 workers
 *   pnpm init:project --force      # 强制覆盖现有配置
 *   pnpm init:project --production --dry-run # 预演生产初始化，不执行写入
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT_DIR, 'apps/web');
let SELECTED_ACCOUNT_ID = '';
let DRY_RUN = false;

// 生产环境 worker 名称映射
const PRODUCTION_WORKER_NAMES = {
  'wrangler.preview.toml': 'skillscat-web-production',
  'wrangler.github-events.toml': 'skillscat-github-events-production',
  'wrangler.indexing.toml': 'skillscat-indexing-production',
  'wrangler.classification.toml': 'skillscat-classification-production',
  'wrangler.security-analysis.toml': 'skillscat-security-analysis-production',
  'wrangler.metrics.toml': 'skillscat-metrics-production',
  'wrangler.trending.toml': 'skillscat-trending-production',
  'wrangler.virustotal.toml': 'skillscat-virustotal-production',
  'wrangler.search-precompute.toml': 'skillscat-search-precompute-production',
  'wrangler.tier-recalc.toml': 'skillscat-tier-recalc-production',
  'wrangler.archive.toml': 'skillscat-archive-production',
  'wrangler.resurrection.toml': 'skillscat-resurrection-production',
};

// 配置文件列表 (单文件，通过 env.production 区分生产环境)
const CONFIG_FILES = [
  'wrangler.preview.toml',
  'wrangler.github-events.toml',
  'wrangler.indexing.toml',
  'wrangler.classification.toml',
  'wrangler.security-analysis.toml',
  'wrangler.metrics.toml',
  'wrangler.trending.toml',
  'wrangler.virustotal.toml',
  'wrangler.search-precompute.toml',
  'wrangler.tier-recalc.toml',
  'wrangler.archive.toml',
  'wrangler.resurrection.toml',
];

const R2_REQUIRED_WORKERS = new Set([
  'preview',
  'github-events',
  'indexing',
  'classification',
  'security-analysis',
  'trending',
  'virustotal',
  'tier-recalc',
  'archive',
  'resurrection',
]);

const KV_REQUIRED_WORKERS = new Set([
  'preview',
  'github-events',
  'indexing',
  'classification',
  'security-analysis',
  'metrics',
  'trending',
  'virustotal',
  'tier-recalc',
  'archive',
  'resurrection',
]);

const QUEUE_REQUIRED_WORKERS = new Set([
  'preview',
  'github-events',
  'indexing',
  'classification',
  'security-analysis',
  'metrics',
  'trending',
]);

const REQUIRED_SECRETS_BY_WORKER = {
  preview: ['BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_TOKEN'],
  'github-events': ['GITHUB_TOKEN'],
  indexing: ['GITHUB_TOKEN'],
  classification: [],
  'security-analysis': ['GITHUB_TOKEN'],
  metrics: [],
  trending: ['GITHUB_TOKEN'],
  virustotal: ['GITHUB_TOKEN'],
  'search-precompute': ['WORKER_SECRET'],
  'tier-recalc': [],
  archive: [],
  resurrection: ['GITHUB_TOKEN'],
};

const OPTIONAL_SECRETS_BY_WORKER = {
  preview: ['INDEXNOW_KEY'],
  'github-events': [],
  indexing: ['INDEXNOW_KEY'],
  classification: ['OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY'],
  'security-analysis': ['OPENROUTER_API_KEY'],
  metrics: [],
  trending: [],
  virustotal: ['VIRUSTOTAL_API_KEY'],
  'search-precompute': [],
  'tier-recalc': [],
  archive: [],
  resurrection: [],
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function splitListArg(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getWorkerKeyFromConfigFile(configFile) {
  const match = /^wrangler\.(.+)\.toml$/.exec(configFile);
  return match ? match[1] : configFile;
}

function resolveSelectedWorkers(args) {
  const requested = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--workers' || arg === '--worker') {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      requested.push(...splitListArg(value));
      i += 1;
      continue;
    }

    if (arg.startsWith('--workers=')) {
      requested.push(...splitListArg(arg.slice('--workers='.length)));
      continue;
    }

    if (arg.startsWith('--worker=')) {
      requested.push(...splitListArg(arg.slice('--worker='.length)));
    }
  }

  if (requested.length === 0) {
    return null;
  }

  const aliasToKey = new Map();
  for (const configFile of CONFIG_FILES) {
    const workerKey = getWorkerKeyFromConfigFile(configFile);
    const productionName = PRODUCTION_WORKER_NAMES[configFile];

    aliasToKey.set(workerKey.toLowerCase(), workerKey);
    aliasToKey.set(configFile.toLowerCase(), workerKey);
    if (productionName) {
      aliasToKey.set(productionName.toLowerCase(), workerKey);
    }
  }
  aliasToKey.set('web', 'preview');

  const selected = [];
  const unknown = [];
  const seen = new Set();

  for (const rawValue of requested) {
    const value = rawValue.trim();
    if (!value) continue;
    const resolved = aliasToKey.get(value.toLowerCase());
    if (!resolved) {
      unknown.push(value);
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    selected.push(resolved);
  }

  if (unknown.length > 0) {
    const allowed = CONFIG_FILES.map((file) => getWorkerKeyFromConfigFile(file)).join(', ');
    throw new Error(`Unknown worker(s): ${unknown.join(', ')}. Allowed values: ${allowed}`);
  }

  return selected;
}

function getSelectedConfigFiles(selectedWorkerKeys) {
  if (!selectedWorkerKeys || selectedWorkerKeys.length === 0) {
    return [...CONFIG_FILES];
  }

  const selectedSet = new Set(selectedWorkerKeys);
  return CONFIG_FILES.filter((configFile) => selectedSet.has(getWorkerKeyFromConfigFile(configFile)));
}

function getSelectedProductionWorkers(selectedConfigFiles, selectedWorkerKeys) {
  const workers = new Set(
    selectedConfigFiles
      .map((configFile) => PRODUCTION_WORKER_NAMES[configFile])
      .filter(Boolean)
  );

  // search-precompute calls back into the web worker's internal admin route,
  // so both sides must share the same WORKER_SECRET in production.
  if (!selectedWorkerKeys || selectedWorkerKeys.length === 0 || selectedWorkerKeys.includes('search-precompute')) {
    workers.add(PRODUCTION_WORKER_NAMES['wrangler.preview.toml']);
  }

  return Array.from(workers).filter(Boolean);
}

function getRequiredResources(selectedWorkerKeys) {
  const workerKeys = selectedWorkerKeys && selectedWorkerKeys.length > 0
    ? selectedWorkerKeys
    : CONFIG_FILES.map((configFile) => getWorkerKeyFromConfigFile(configFile));

  const needsD1 = workerKeys.length > 0;
  const needsR2 = workerKeys.some((key) => R2_REQUIRED_WORKERS.has(key));
  const needsKV = workerKeys.some((key) => KV_REQUIRED_WORKERS.has(key));
  const needsQueues = workerKeys.some((key) => QUEUE_REQUIRED_WORKERS.has(key));

  return { needsD1, needsR2, needsKV, needsQueues };
}

function getSecretRequirements(selectedWorkerKeys) {
  const workerKeys = selectedWorkerKeys && selectedWorkerKeys.length > 0
    ? selectedWorkerKeys
    : CONFIG_FILES.map((configFile) => getWorkerKeyFromConfigFile(configFile));

  const required = new Set();
  const optional = new Set();

  for (const workerKey of workerKeys) {
    for (const key of (REQUIRED_SECRETS_BY_WORKER[workerKey] || [])) {
      required.add(key);
    }
    for (const key of (OPTIONAL_SECRETS_BY_WORKER[workerKey] || [])) {
      optional.add(key);
    }
  }

  return {
    required: Array.from(required),
    optional: Array.from(optional),
  };
}

function logStep(step, message) {
  console.log(`\n${colors.cyan}[${step}]${colors.reset} ${colors.bold}${message}${colors.reset}`);
}

function logSuccess(message) {
  console.log(`  ${colors.green}✓${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`  ${colors.yellow}⚠${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`  ${colors.red}✗${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`  ${colors.gray}${message}${colors.reset}`);
}

function logDryRun(message) {
  logInfo(`[dry-run] ${message}`);
}

function getWranglerEnv(extra = {}) {
  const base = { ...process.env, ...extra };
  if (SELECTED_ACCOUNT_ID) {
    base.CLOUDFLARE_ACCOUNT_ID = SELECTED_ACCOUNT_ID;
  }
  return base;
}

/**
 * 生成随机 secret
 */
function generateSecret(length = 32) {
  return randomBytes(length).toString('base64url').slice(0, length);
}

/**
 * 读取现有的 .dev.vars 文件
 */
function readExistingDevVars() {
  const devVarsPath = resolve(WEB_DIR, '.dev.vars');
  if (!existsSync(devVarsPath)) return {};

  const content = readFileSync(devVarsPath, 'utf-8');
  const vars = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Only keep values that are not placeholders
      if (value && !value.startsWith('your-') && !value.startsWith('<')) {
        vars[key] = value;
      }
    }
  }
  return vars;
}

/**
 * 创建 readline 接口
 */
function createReadline() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 询问用户问题
 */
async function ask(rl, question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue
      ? `${question} ${colors.gray}(${defaultValue})${colors.reset}: `
      : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * 询问是/否问题
 */
async function askYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(rl, `${question} (${hint})`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

/**
 * 检查 wrangler CLI 是否可用
 */
function checkWranglerCLI() {
  try {
    execSync('npx wrangler --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查是否已登录 Cloudflare
 */
function checkCloudflareAuth() {
  try {
    execSync('npx wrangler whoami', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function listCloudflareAccounts() {
  const result = runWrangler('whoami', { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const accounts = [];
  for (const line of result.output.split('\n')) {
    const match = line.match(/^\s*│\s*(.*?)\s*│\s*([a-f0-9]{32})\s*│\s*$/i);
    if (!match) continue;
    accounts.push({
      name: match[1].trim(),
      id: match[2].trim(),
    });
  }

  if (accounts.length === 0) {
    return { success: false, error: 'No Cloudflare accounts found in wrangler whoami output' };
  }

  return { success: true, accounts };
}

async function selectCloudflareAccount(rl) {
  const result = listCloudflareAccounts();
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const { accounts } = result;

  if (accounts.length === 1) {
    return { success: true, accountId: accounts[0].id, accountName: accounts[0].name };
  }

  console.log('\nAvailable Cloudflare accounts:');
  accounts.forEach((account, index) => {
    console.log(`  ${index + 1}. ${account.name} (${account.id})`);
  });

  const answer = await ask(
    rl,
    'Select Cloudflare account (number or Account ID)',
    '1'
  );

  const byIndex = Number(answer);
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= accounts.length) {
    const account = accounts[byIndex - 1];
    return { success: true, accountId: account.id, accountName: account.name };
  }

  const byId = accounts.find((account) => account.id === answer.trim());
  if (byId) {
    return { success: true, accountId: byId.id, accountName: byId.name };
  }

  return {
    success: false,
    error: `Invalid account selection: ${answer}. Please rerun and choose a valid account.`,
  };
}

/**
 * 执行 wrangler 命令并返回输出
 */
function runWrangler(args, options = {}) {
  try {
    const { env: commandEnv, silent = false, ...rest } = options;
    const mergedEnv = getWranglerEnv(commandEnv || {});
    const result = execSync(`npx wrangler ${args}`, {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
      env: mergedEnv,
      ...rest,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 复制 wrangler 配置文件 (从 example 复制)
 * @param {string[]} configFiles - 目标配置文件列表
 * @param {boolean} force - 强制覆盖
 */
function copyWranglerConfigs(configFiles, force = false) {
  const copied = [];
  const skipped = [];

  for (const config of configFiles) {
    const examplePath = resolve(WEB_DIR, `${config}.example`);
    const targetPath = resolve(WEB_DIR, config);

    if (!existsSync(examplePath)) {
      logWarning(`Example file not found: ${config}.example`);
      continue;
    }

    if (existsSync(targetPath) && !force) {
      skipped.push(config);
      continue;
    }

    // 读取 example 文件
    let content = readFileSync(examplePath, 'utf-8');

    // 顶层配置用于本地预览: 将本地 placeholder 固定替换为 local
    content = content.replace(/<your-database-id>/g, 'local');
    content = content.replace(/<your-kv-namespace-id>/g, 'local');

    if (DRY_RUN) {
      logDryRun(`Would create ${config} from ${config}.example`);
    } else {
      writeFileSync(targetPath, content);
    }
    copied.push(config);
  }

  return { copied, skipped };
}

const PRODUCTION_ENV_SNIPPETS = {
  'wrangler.preview.toml': `
[env.production]
name = "skillscat-web-production"

[env.production.assets]
binding = "ASSETS"
directory = ".svelte-kit/cloudflare"

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[[env.production.queues.producers]]
binding = "INDEXING_QUEUE"
queue = "skillscat-indexing"

[[env.production.queues.producers]]
binding = "CLASSIFICATION_QUEUE"
queue = "skillscat-classification"

[[env.production.queues.producers]]
binding = "SECURITY_ANALYSIS_QUEUE"
queue = "skillscat-security-analysis"

[[env.production.queues.producers]]
binding = "METRICS_QUEUE"
queue = "skillscat-metrics"

[env.production.vars]
PUBLIC_APP_URL = "https://your-domain.com"
CACHE_VERSION = "v1"
SITEMAP_REFRESH_MIN_INTERVAL_SECONDS = "3600"
RECOMMEND_ALGO_VERSION = "v1"
INDEXNOW_ENABLED = "1"
`.trim(),
  'wrangler.github-events.toml': `
[env.production]
name = "skillscat-github-events-production"

[env.production.triggers]
crons = ["*/5 * * * *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.queues.producers]]
binding = "INDEXING_QUEUE"
queue = "skillscat-indexing"

[env.production.vars]
GITHUB_EVENTS_PER_PAGE = "100"
`.trim(),
  'wrangler.indexing.toml': `
[env.production]
name = "skillscat-indexing-production"

[[env.production.queues.consumers]]
queue = "skillscat-indexing"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "skillscat-indexing-dlq"

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[[env.production.queues.producers]]
binding = "CLASSIFICATION_QUEUE"
queue = "skillscat-classification"

[[env.production.queues.producers]]
binding = "SECURITY_ANALYSIS_QUEUE"
queue = "skillscat-security-analysis"

[env.production.vars]
GITHUB_API_VERSION = "2022-11-28"
INDEXNOW_ENABLED = "1"
`.trim(),
  'wrangler.classification.toml': `
[env.production]
name = "skillscat-classification-production"

[[env.production.queues.consumers]]
queue = "skillscat-classification"
max_batch_size = 5
max_batch_timeout = 60
max_retries = 3
dead_letter_queue = "skillscat-classification-dlq"

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[env.production.vars]
AI_MODEL = "openrouter/free"
CLASSIFICATION_PAID_MODEL = "openai/gpt-5.4-nano"
`.trim(),
  'wrangler.security-analysis.toml': `
[env.production]
name = "skillscat-security-analysis-production"

[env.production.triggers]
crons = ["*/15 * * * *"]

[[env.production.queues.consumers]]
queue = "skillscat-security-analysis"
max_batch_size = 5
max_batch_timeout = 60
max_retries = 3
dead_letter_queue = "skillscat-security-analysis-dlq"

[[env.production.queues.producers]]
binding = "INDEXING_QUEUE"
queue = "skillscat-indexing"

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[env.production.vars]
SECURITY_FREE_MODEL = "openrouter/free"
SECURITY_PREMIUM_MODEL = "openai/gpt-5.4-nano"
SECURITY_MAX_AI_FILES = "8"
SECURITY_MAX_AI_TEXT_BYTES = "48000"
SECURITY_STABILITY_ROUNDS = "2"
SECURITY_HEURISTIC_THRESHOLD = "4.5"
`.trim(),
  'wrangler.metrics.toml': `
[env.production]
name = "skillscat-metrics-production"

[[env.production.queues.consumers]]
queue = "skillscat-metrics"
max_batch_size = 100
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "skillscat-metrics-dlq"

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"
`.trim(),
  'wrangler.trending.toml': `
[env.production]
name = "skillscat-trending-production"

[env.production.triggers]
crons = ["0 * * * *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[[env.production.queues.producers]]
binding = "SECURITY_ANALYSIS_QUEUE"
queue = "skillscat-security-analysis"

[env.production.vars]
TRENDING_DECAY_HOURS = "72"
TRENDING_STAR_WEIGHT = "1.0"
TRENDING_FORK_WEIGHT = "2.0"
TRENDING_VIEW_WEIGHT = "0.1"
CACHE_VERSION = "v1"
SECURITY_PREMIUM_TOP_N = "50"
`.trim(),
  'wrangler.virustotal.toml': `
[env.production]
name = "skillscat-virustotal-production"

[env.production.triggers]
crons = ["* * * * *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"

[env.production.vars]
VT_ENABLED = "1"
VT_DAILY_REQUEST_BUDGET = "300"
VT_MINUTE_REQUEST_BUDGET = "4"
VT_UPLOAD_MAX_BYTES = "33554432"
`.trim(),
  'wrangler.search-precompute.toml': `
[env.production]
name = "skillscat-search-precompute-production"

[env.production.triggers]
crons = ["15 * * * *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[env.production.vars]
APP_ORIGIN = "https://your-domain.com"
SITEMAP_REFRESH_ENABLED = "1"
SITEMAP_REFRESH_TIMEOUT_MS = "20000"
RECOMMEND_PRECOMPUTE_ENABLED = "1"
RECOMMEND_PRECOMPUTE_MAX_PER_RUN = "200"
RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS = "15000"
RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS = "2500"
RECOMMEND_ALGO_VERSION = "v1"
SEARCH_PRECOMPUTE_ENABLED = "1"
SEARCH_PRECOMPUTE_MAX_PER_RUN = "500"
SEARCH_PRECOMPUTE_TIME_BUDGET_MS = "10000"
SEARCH_PRECOMPUTE_ALGO_VERSION = "v1"
`.trim(),
  'wrangler.tier-recalc.toml': `
[env.production]
name = "skillscat-tier-recalc-production"

[env.production.triggers]
crons = ["0 3 * * *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"
`.trim(),
  'wrangler.archive.toml': `
[env.production]
name = "skillscat-archive-production"

[env.production.triggers]
crons = ["0 4 1 * *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"
`.trim(),
  'wrangler.resurrection.toml': `
[env.production]
name = "skillscat-resurrection-production"

[env.production.triggers]
crons = ["0 5 1 1,4,7,10 *"]

[[env.production.d1_databases]]
binding = "DB"
database_name = "skillscat-db"
database_id = "<your-production-database-id>"

[[env.production.r2_buckets]]
binding = "R2"
bucket_name = "skillscat-storage"

[[env.production.kv_namespaces]]
binding = "KV"
id = "<your-production-kv-namespace-id>"
`.trim(),
};

function ensureProductionEnvSection(configFile) {
  const configPath = resolve(WEB_DIR, configFile);
  if (!existsSync(configPath)) {
    return { exists: false, added: false };
  }

  const snippet = PRODUCTION_ENV_SNIPPETS[configFile];
  if (!snippet) {
    return { exists: true, added: false };
  }

  const content = readFileSync(configPath, 'utf-8');
  if (content.includes('[env.production]')) {
    return { exists: true, added: false };
  }

  if (DRY_RUN) {
    logDryRun(`Would append [env.production] to ${configFile}`);
    return { exists: true, added: true };
  }

  const next = `${content.trim()}\n\n${snippet}\n`;
  writeFileSync(configPath, next);
  return { exists: true, added: true };
}

function ensureProductionWorkerName(configFile) {
  const expectedName = PRODUCTION_WORKER_NAMES[configFile];
  if (!expectedName) return { exists: false, updated: false };

  const configPath = resolve(WEB_DIR, configFile);
  if (!existsSync(configPath)) {
    return { exists: false, updated: false };
  }

  const lines = readFileSync(configPath, 'utf-8').split('\n');
  let inProduction = false;
  let productionStart = -1;
  let nameLineIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '[env.production]') {
      inProduction = true;
      productionStart = i;
      continue;
    }

    if (inProduction && /^\[/.test(trimmed)) {
      break;
    }

    if (inProduction && /^name\s*=/.test(trimmed)) {
      nameLineIndex = i;
      break;
    }
  }

  if (productionStart === -1) {
    return { exists: true, updated: false };
  }

  if (nameLineIndex !== -1) {
    const current = lines[nameLineIndex].trim();
    if (current === `name = "${expectedName}"`) {
      return { exists: true, updated: false };
    }

    if (DRY_RUN) {
      logDryRun(`Would set env.production name in ${configFile} -> ${expectedName}`);
      return { exists: true, updated: true };
    }

    lines[nameLineIndex] = `name = "${expectedName}"`;
    writeFileSync(configPath, `${lines.join('\n')}\n`);
    return { exists: true, updated: true };
  }

  if (DRY_RUN) {
    logDryRun(`Would insert env.production name in ${configFile} -> ${expectedName}`);
    return { exists: true, updated: true };
  }

  lines.splice(productionStart + 1, 0, `name = "${expectedName}"`);
  writeFileSync(configPath, `${lines.join('\n')}\n`);
  return { exists: true, updated: true };
}

function ensureWorkerRuntimeSettings(configFile) {
  const configPath = resolve(WEB_DIR, configFile);
  if (!existsSync(configPath)) {
    return { exists: false, updated: false };
  }

  const originalContent = readFileSync(configPath, 'utf-8');
  let lines = originalContent.split('\n');

  lines = lines.filter((line) => {
    const trimmed = line.trim();
    return !/^workers_dev\s*=/.test(trimmed) && !/^preview_urls\s*=/.test(trimmed);
  });

  const withoutObservability = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '[observability]') {
      i += 1;
      while (i < lines.length) {
        const current = lines[i].trim();
        if (current.startsWith('[')) {
          i -= 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    withoutObservability.push(lines[i]);
  }
  lines = withoutObservability;

  let anchorIndex = lines.findIndex((line) => /^\s*account_id\s*=/.test(line));
  if (anchorIndex === -1) {
    anchorIndex = lines.findIndex((line) => /^\s*compatibility_flags\s*=/.test(line));
  }
  if (anchorIndex === -1) {
    anchorIndex = lines.findIndex((line) => /^\s*compatibility_date\s*=/.test(line));
  }
  if (anchorIndex === -1) {
    anchorIndex = lines.findIndex((line) => /^\s*main\s*=/.test(line));
  }
  if (anchorIndex === -1) {
    anchorIndex = lines.findIndex((line) => /^\s*name\s*=/.test(line));
  }

  let insertAt = anchorIndex >= 0 ? anchorIndex + 1 : 0;
  if (insertAt === 0) {
    const firstSection = lines.findIndex((line) => line.trim().startsWith('['));
    insertAt = firstSection >= 0 ? firstSection : lines.length;
  }

  lines.splice(
    insertAt,
    0,
    '',
    'workers_dev = false',
    'preview_urls = false',
    '',
    '[observability]',
    'enabled = true',
    'head_sampling_rate = 1'
  );

  const nextContent = `${lines.join('\n').replace(/\n+$/g, '')}\n`;
  if (nextContent === originalContent) {
    return { exists: true, updated: false };
  }

  if (DRY_RUN) {
    logDryRun(`Would enforce workers_dev/preview_urls/observability in ${configFile}`);
    return { exists: true, updated: true };
  }

  writeFileSync(configPath, nextContent);
  return { exists: true, updated: true };
}

function setProductionPublicAppUrl(url) {
  const configPath = resolve(WEB_DIR, 'wrangler.preview.toml');
  if (!existsSync(configPath)) return { exists: false, updated: false };

  const lines = readFileSync(configPath, 'utf-8').split('\n');
  const escaped = url.replace(/"/g, '\\"');
  let inVarsBlock = false;
  let varsBlockStart = -1;
  let updated = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    if (trimmed === '[env.production.vars]') {
      inVarsBlock = true;
      varsBlockStart = i;
      continue;
    }

    if (inVarsBlock) {
      if (/^PUBLIC_APP_URL\s*=/.test(trimmed)) {
        lines[i] = `PUBLIC_APP_URL = "${escaped}"`;
        updated = true;
        break;
      }

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        lines.splice(i, 0, `PUBLIC_APP_URL = "${escaped}"`);
        updated = true;
        break;
      }
    }
  }

  if (!updated && varsBlockStart >= 0) {
    lines.splice(varsBlockStart + 1, 0, `PUBLIC_APP_URL = "${escaped}"`);
    updated = true;
  }

  if (!updated) {
    lines.push('', '[env.production.vars]', `PUBLIC_APP_URL = "${escaped}"`);
    updated = true;
  }

  if (DRY_RUN) {
    logDryRun(`Would set env.production PUBLIC_APP_URL in wrangler.preview.toml -> ${url}`);
    return { exists: true, updated };
  }

  writeFileSync(configPath, `${lines.join('\n').trim()}\n`);
  return { exists: true, updated };
}

function upsertTomlVarsEntries(configFile, blockHeader, entries) {
  const configPath = resolve(WEB_DIR, configFile);
  if (!existsSync(configPath)) return { exists: false, updated: false };

  const lines = readFileSync(configPath, 'utf-8').split('\n');
  const escapedEntries = Object.entries(entries).map(([key, value]) => [key, String(value).replace(/"/g, '\\"')]);

  let blockStart = -1;
  let blockEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === blockHeader) {
      blockStart = i;
      blockEnd = lines.length;
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed.startsWith('[') && nextTrimmed.endsWith(']')) {
          blockEnd = j;
          break;
        }
      }
      break;
    }
  }

  let updated = false;

  if (blockStart === -1) {
    lines.push('', blockHeader);
    for (const [key, escaped] of escapedEntries) {
      lines.push(`${key} = "${escaped}"`);
    }
    updated = true;
  } else {
    for (const [key, escaped] of escapedEntries) {
      const pattern = new RegExp(`^${key}\\s*=`);
      let keyLineIndex = -1;
      for (let i = blockStart + 1; i < blockEnd; i += 1) {
        if (pattern.test(lines[i].trim())) {
          keyLineIndex = i;
          break;
        }
      }

      const expectedLine = `${key} = "${escaped}"`;
      if (keyLineIndex !== -1) {
        if (lines[keyLineIndex] !== expectedLine) {
          lines[keyLineIndex] = expectedLine;
          updated = true;
        }
      } else {
        lines.splice(blockEnd, 0, expectedLine);
        blockEnd += 1;
        updated = true;
      }
    }
  }

  if (!updated) return { exists: true, updated: false };

  if (DRY_RUN) {
    logDryRun(`Would update ${blockHeader} vars in ${configFile}`);
    return { exists: true, updated: true };
  }

  writeFileSync(configPath, `${lines.join('\n').trim()}\n`);
  return { exists: true, updated: true };
}

function ensurePrecomputeWorkerEnvVars({
  productionAppUrl,
  includeProductionVars = true,
  includePreview = true,
  includeSearchPrecompute = true,
} = {}) {
  const results = [];

  if (includePreview) {
    results.push(
      upsertTomlVarsEntries('wrangler.preview.toml', '[vars]', {
        SITEMAP_REFRESH_MIN_INTERVAL_SECONDS: '3600',
        RECOMMEND_ALGO_VERSION: 'v1',
      }),
    );

    if (includeProductionVars) {
      results.push(
        upsertTomlVarsEntries('wrangler.preview.toml', '[env.production.vars]', {
          CACHE_VERSION: 'v1',
          SITEMAP_REFRESH_MIN_INTERVAL_SECONDS: '3600',
          RECOMMEND_ALGO_VERSION: 'v1',
        }),
      );
    }
  }

  if (includeSearchPrecompute) {
    results.push(
      upsertTomlVarsEntries('wrangler.search-precompute.toml', '[vars]', {
        APP_ORIGIN: 'http://localhost:3000',
        SITEMAP_REFRESH_ENABLED: '1',
        SITEMAP_REFRESH_TIMEOUT_MS: '20000',
        RECOMMEND_PRECOMPUTE_ENABLED: '1',
        RECOMMEND_PRECOMPUTE_MAX_PER_RUN: '200',
        RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS: '15000',
        RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS: '2500',
        RECOMMEND_ALGO_VERSION: 'v1',
        SEARCH_PRECOMPUTE_ENABLED: '1',
        SEARCH_PRECOMPUTE_MAX_PER_RUN: '500',
        SEARCH_PRECOMPUTE_TIME_BUDGET_MS: '10000',
        SEARCH_PRECOMPUTE_ALGO_VERSION: 'v1',
      }),
    );
  }

  if (includeProductionVars && includeSearchPrecompute) {
    const precomputeProductionVars = {
      APP_ORIGIN: productionAppUrl || 'https://your-domain.com',
      SITEMAP_REFRESH_ENABLED: '1',
      SITEMAP_REFRESH_TIMEOUT_MS: '20000',
      RECOMMEND_PRECOMPUTE_ENABLED: '1',
      RECOMMEND_PRECOMPUTE_MAX_PER_RUN: '200',
      RECOMMEND_PRECOMPUTE_TIME_BUDGET_MS: '15000',
      RECOMMEND_PRECOMPUTE_REQUEST_TIMEOUT_MS: '2500',
      RECOMMEND_ALGO_VERSION: 'v1',
      SEARCH_PRECOMPUTE_ENABLED: '1',
      SEARCH_PRECOMPUTE_MAX_PER_RUN: '500',
      SEARCH_PRECOMPUTE_TIME_BUDGET_MS: '10000',
      SEARCH_PRECOMPUTE_ALGO_VERSION: 'v1',
    };

    results.push(
      upsertTomlVarsEntries('wrangler.search-precompute.toml', '[env.production.vars]', precomputeProductionVars),
    );
  }

  return results;
}

function ensureIndexNowEnvVars({
  includeProductionVars = true,
  includePreview = true,
  includeIndexing = true,
} = {}) {
  const results = [];

  if (includePreview) {
    results.push(
      upsertTomlVarsEntries('wrangler.preview.toml', '[vars]', {
        INDEXNOW_ENABLED: '0',
      }),
    );

    if (includeProductionVars) {
      results.push(
        upsertTomlVarsEntries('wrangler.preview.toml', '[env.production.vars]', {
          INDEXNOW_ENABLED: '1',
        }),
      );
    }
  }

  if (includeIndexing) {
    results.push(
      upsertTomlVarsEntries('wrangler.indexing.toml', '[vars]', {
        INDEXNOW_ENABLED: '0',
      }),
    );

    if (includeProductionVars) {
      results.push(
        upsertTomlVarsEntries('wrangler.indexing.toml', '[env.production.vars]', {
          INDEXNOW_ENABLED: '1',
        }),
      );
    }
  }

  return results;
}

/**
 * 创建 .dev.vars 文件
 */
function createDevVars(vars, force = false) {
  const devVarsPath = resolve(WEB_DIR, '.dev.vars');

  if (existsSync(devVarsPath) && !force) {
    return { created: false, path: devVarsPath };
  }

  const content = Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  if (DRY_RUN) {
    logDryRun(`Would write ${devVarsPath}`);
    return { created: true, path: devVarsPath };
  }

  writeFileSync(devVarsPath, content + '\n');
  return { created: true, path: devVarsPath };
}

/**
 * 更新 wrangler.toml 中 D1 / KV 资源 ID
 * @param {string} configFile
 * @param {{ databaseId?: string, kvId?: string }} resourceIds
 * @param {{ replaceLocal?: boolean, replaceAny?: boolean, targetScope?: 'any' | 'top' | 'production' }} options
 */
function updateWranglerConfig(configFile, resourceIds, options = {}) {
  const { replaceLocal = false, replaceAny = false, targetScope = 'any' } = options;
  const configPath = resolve(WEB_DIR, configFile);

  if (!existsSync(configPath)) {
    return { exists: false, updated: false };
  }

  const lines = readFileSync(configPath, 'utf-8').split('\n');
  let currentBlock = '';
  let currentScope = 'top';
  let updated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跟踪当前 TOML block，避免误替换其他字段中的 id
    if (/^\[\[(?:env\.production\.)?d1_databases\]\]$/.test(trimmed)) {
      currentBlock = 'd1';
      currentScope = trimmed.includes('env.production.') ? 'production' : 'top';
      continue;
    }
    if (/^\[\[(?:env\.production\.)?kv_namespaces\]\]$/.test(trimmed)) {
      currentBlock = 'kv';
      currentScope = trimmed.includes('env.production.') ? 'production' : 'top';
      continue;
    }
    if (trimmed.startsWith('[[') || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      currentBlock = '';
      currentScope = 'top';
    }

    const inTargetScope = targetScope === 'any' || targetScope === currentScope;
    if (!inTargetScope) {
      continue;
    }

    if (currentBlock === 'd1' && resourceIds.databaseId) {
      const match = line.match(/^(\s*database_id\s*=\s*")([^"]*)(".*)$/);
      if (match) {
        const currentValue = match[2];
        if (
          replaceAny ||
          currentValue === '<your-database-id>' ||
          currentValue === '<your-production-database-id>' ||
          (replaceLocal && currentValue === 'local')
        ) {
          lines[i] = `${match[1]}${resourceIds.databaseId}${match[3]}`;
          updated = true;
        }
      }
    }

    if (currentBlock === 'kv' && resourceIds.kvId) {
      const match = line.match(/^(\s*id\s*=\s*")([^"]*)(".*)$/);
      if (match) {
        const currentValue = match[2];
        if (
          replaceAny ||
          currentValue === '<your-kv-namespace-id>' ||
          currentValue === '<your-production-kv-namespace-id>' ||
          (replaceLocal && currentValue === 'local')
        ) {
          lines[i] = `${match[1]}${resourceIds.kvId}${match[3]}`;
          updated = true;
        }
      }
    }
  }

  if (updated) {
    if (DRY_RUN) {
      logDryRun(`Would update resource IDs in ${configFile}`);
    } else {
      writeFileSync(configPath, lines.join('\n'));
    }
  }
  return { exists: true, updated };
}

function updateWranglerAccountId(configFile, accountId) {
  const configPath = resolve(WEB_DIR, configFile);
  if (!existsSync(configPath)) {
    return { exists: false, updated: false };
  }

  const lines = readFileSync(configPath, 'utf-8').split('\n');
  let updated = false;
  let hasAccountLine = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*account_id\s*=/.test(lines[i])) {
      lines[i] = `account_id = "${accountId}"`;
      hasAccountLine = true;
      updated = true;
      break;
    }
  }

  if (!hasAccountLine) {
    let insertAt = lines.findIndex((line) => /^\s*compatibility_flags\s*=/.test(line));
    if (insertAt === -1) {
      insertAt = lines.findIndex((line) => /^\s*compatibility_date\s*=/.test(line));
    }

    if (insertAt === -1) {
      lines.unshift(`account_id = "${accountId}"`);
    } else {
      lines.splice(insertAt + 1, 0, `account_id = "${accountId}"`);
    }
    updated = true;
  }

  if (updated) {
    if (DRY_RUN) {
      logDryRun(`Would update account_id in ${configFile} -> ${accountId}`);
    } else {
      writeFileSync(configPath, `${lines.join('\n').trim()}\n`);
    }
  }

  return { exists: true, updated };
}

/**
 * 安全解析 JSON
 */
function safeParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findD1Database(name) {
  const result = runWrangler('d1 list --json', { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const databases = safeParseJSON(result.output);
  if (!Array.isArray(databases)) {
    return { success: false, error: 'Failed to parse d1 list --json output' };
  }

  const db = databases.find((item) => item?.name === name);
  return {
    success: true,
    exists: Boolean(db),
    id: db?.uuid ?? db?.id ?? null,
  };
}

function findKVNamespace(title) {
  const result = runWrangler('kv namespace list', { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const parsed = safeParseJSON(result.output);
  if (Array.isArray(parsed)) {
    const found = parsed.find((item) => item?.title === title);
    return { success: true, exists: Boolean(found), id: found?.id ?? null };
  }

  for (const line of result.output.split('\n')) {
    if (!line.includes(title)) continue;
    const idMatch = line.match(/([a-f0-9]{32}|[a-f0-9-]{36})/i);
    if (idMatch) {
      return { success: true, exists: true, id: idMatch[1] };
    }
  }

  return { success: true, exists: false, id: null };
}

function checkR2BucketExists(name) {
  const result = runWrangler('r2 bucket list', { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const exists = result.output
    .split('\n')
    .some((line) => line.trim() && line.includes(name));

  return { success: true, exists };
}

function checkQueueExists(name) {
  const result = runWrangler('queues list', { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const exists = result.output
    .split('\n')
    .some((line) => line.trim() && line.includes(name));

  return { success: true, exists };
}

/**
 * 创建 Cloudflare D1 数据库 (存在则复用)
 */
async function createD1Database(name) {
  const existing = findD1Database(name);
  if (existing.success && existing.exists) {
    logInfo(`D1 database exists, reusing: ${name}`);
    return { success: true, id: existing.id, created: false };
  }
  if (!existing.success) {
    return { success: false, error: `Unable to check existing D1 databases: ${existing.error}` };
  }

  if (DRY_RUN) {
    logDryRun(`Would create D1 database: ${name}`);
    return { success: true, id: '<dry-run-database-id>', created: true };
  }

  logInfo(`Creating D1 database: ${name}`);
  const result = runWrangler(`d1 create ${name}`, { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  let id = result.output?.match(/database_id\s*=\s*"([^"]+)"/)?.[1] ?? null;
  if (!id) {
    const refreshed = findD1Database(name);
    if (refreshed.success && refreshed.exists) {
      id = refreshed.id;
    }
  }

  if (!id) {
    return { success: false, error: `Created D1 database ${name} but failed to resolve database id` };
  }

  return { success: true, id, created: true };
}

/**
 * 创建 Cloudflare R2 bucket (存在则复用)
 */
async function createR2Bucket(name) {
  const existing = checkR2BucketExists(name);
  if (existing.success && existing.exists) {
    logInfo(`R2 bucket exists, reusing: ${name}`);
    return { success: true, name, created: false };
  }
  if (!existing.success) {
    return { success: false, error: `Unable to check existing R2 buckets: ${existing.error}` };
  }

  if (DRY_RUN) {
    logDryRun(`Would create R2 bucket: ${name}`);
    return { success: true, name, created: true };
  }

  logInfo(`Creating R2 bucket: ${name}`);
  const result = runWrangler(`r2 bucket create ${name}`, { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, name, created: true };
}

/**
 * 创建 Cloudflare KV namespace (存在则复用)
 */
async function createKVNamespace(title) {
  const existing = findKVNamespace(title);
  if (existing.success && existing.exists) {
    logInfo(`KV namespace exists, reusing: ${title}`);
    return { success: true, id: existing.id, created: false };
  }
  if (!existing.success) {
    return { success: false, error: `Unable to check existing KV namespaces: ${existing.error}` };
  }

  if (DRY_RUN) {
    logDryRun(`Would create KV namespace: ${title}`);
    return { success: true, id: '<dry-run-kv-namespace-id>', created: true };
  }

  logInfo(`Creating KV namespace: ${title}`);
  const result = runWrangler(`kv namespace create "${title}"`, { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  let id = result.output?.match(/id\s*=\s*"([^"]+)"/)?.[1] ?? null;
  if (!id) {
    const refreshed = findKVNamespace(title);
    if (refreshed.success && refreshed.exists) {
      id = refreshed.id;
    }
  }

  if (!id) {
    return { success: false, error: `Created KV namespace ${title} but failed to resolve namespace id` };
  }

  return { success: true, id, created: true };
}

/**
 * 创建 Cloudflare Queue (存在则复用)
 */
async function createQueue(name) {
  const existing = checkQueueExists(name);
  if (existing.success && existing.exists) {
    logInfo(`Queue exists, reusing: ${name}`);
    return { success: true, name, created: false };
  }
  if (!existing.success) {
    return { success: false, error: `Unable to check existing queues: ${existing.error}` };
  }

  if (DRY_RUN) {
    logDryRun(`Would create Queue: ${name}`);
    return { success: true, name, created: true };
  }

  logInfo(`Creating Queue: ${name}`);
  const result = runWrangler(`queues create ${name}`, { silent: true, stdio: 'pipe' });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, name, created: true };
}

/**
 * 设置 Cloudflare secret (生产环境)
 */
async function setSecret(workerName, secretName, secretValue, env = 'production') {
  if (DRY_RUN) {
    logDryRun(`Would set secret ${secretName} for ${workerName}${env ? ` (env: ${env})` : ''}`);
    return { success: true };
  }

  logInfo(`Setting secret ${secretName} for ${workerName}`);
  const args = ['wrangler', 'secret', 'put', secretName, '--name', workerName];
  if (env) {
    args.push('--env', env);
  }

  const result = spawnSync('npx', args, {
    cwd: WEB_DIR,
    encoding: 'utf-8',
    input: `${secretValue}\n`,
    env: getWranglerEnv(),
  });

  if (result.status === 0) {
    return { success: true };
  }

  const errorMessage = [result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim() || `Exit code: ${result.status ?? 'unknown'}`;

  return { success: false, error: errorMessage };
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const localOnly = args.includes('--local');
  const isProduction = args.includes('--production');
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const selectedWorkerKeys = resolveSelectedWorkers(args);
  const hasWorkerSelection = Array.isArray(selectedWorkerKeys) && selectedWorkerKeys.length > 0;
  const selectedConfigFiles = getSelectedConfigFiles(selectedWorkerKeys);
  const selectedProductionWorkers = getSelectedProductionWorkers(selectedConfigFiles, selectedWorkerKeys);
  const requiredResources = getRequiredResources(selectedWorkerKeys);
  const secretRequirements = getSecretRequirements(selectedWorkerKeys);
  const requiredSecretKeys = new Set(secretRequirements.required);
  const optionalSecretKeys = new Set(secretRequirements.optional);
  const needsSecretSetup = requiredSecretKeys.size > 0 || optionalSecretKeys.size > 0;
  const needsBetterAuthSecret = requiredSecretKeys.has('BETTER_AUTH_SECRET');
  const needsWorkerSecret = requiredSecretKeys.has('WORKER_SECRET');
  const needsGitHubClientId = requiredSecretKeys.has('GITHUB_CLIENT_ID');
  const needsGitHubClientSecret = requiredSecretKeys.has('GITHUB_CLIENT_SECRET');
  const needsGitHubToken = requiredSecretKeys.has('GITHUB_TOKEN');
  const needsOpenRouter = optionalSecretKeys.has('OPENROUTER_API_KEY');
  const needsDeepSeek = optionalSecretKeys.has('DEEPSEEK_API_KEY');
  const needsVirusTotal = optionalSecretKeys.has('VIRUSTOTAL_API_KEY');
  const needsIndexNowKey = optionalSecretKeys.has('INDEXNOW_KEY');
  const needsGeneratedSecrets = needsBetterAuthSecret || needsWorkerSecret;
  const includePreviewWorker = !hasWorkerSelection || selectedWorkerKeys.includes('preview');
  const includeIndexingWorker = !hasWorkerSelection || selectedWorkerKeys.includes('indexing');
  const includeSearchPrecomputeWorker = !hasWorkerSelection || selectedWorkerKeys.includes('search-precompute');
  const needsProductionAppUrl = includePreviewWorker
    || includeSearchPrecomputeWorker
    || (needsIndexNowKey && includeIndexingWorker);
  const needsEnvInput = needsGitHubClientId
    || needsGitHubClientSecret
    || needsGitHubToken
    || needsOpenRouter
    || needsDeepSeek
    || needsVirusTotal
    || needsIndexNowKey
    || (isProduction && needsProductionAppUrl);
  DRY_RUN = dryRun;

  const modeTitle = isProduction ? '线上环境初始化' : '本地开发环境初始化';
  const modeLabel = dryRun ? `${modeTitle} (Dry Run)` : modeTitle;

  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bold}SkillsCat ${modeLabel}${colors.cyan}                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

  const rl = createReadline();

  try {
    if (DRY_RUN) {
      logDryRun('Running in preview mode. No create/write/secret operations will be executed.');
    }
    if (hasWorkerSelection) {
      logInfo(`Worker scope: ${selectedWorkerKeys.join(', ')}`);
    }

    // 生产模式: 先检查 Cloudflare 认证
    if (isProduction) {
      logStep('1/6', '检查 Cloudflare 认证');

      if (!checkWranglerCLI()) {
        logError('Wrangler CLI not found');
        logInfo('Please install wrangler: npm install -g wrangler');
        process.exit(1);
      }
      logSuccess('Wrangler CLI found');

      if (!checkCloudflareAuth()) {
        logWarning('Not logged in to Cloudflare');
        const shouldLogin = await askYesNo(rl, 'Do you want to login now?');
        if (shouldLogin) {
          console.log('\nOpening browser for Cloudflare login...\n');
          execSync('npx wrangler login', { stdio: 'inherit' });
        } else {
          logError('Cloudflare authentication required for production setup');
          process.exit(1);
        }
      }
      logSuccess('Cloudflare authenticated');

      logStep('2/6', '选择 Cloudflare Account');
      const accountResult = await selectCloudflareAccount(rl);
      if (!accountResult.success) {
        logError(`Failed to resolve Cloudflare account: ${accountResult.error}`);
        process.exit(1);
      }
      SELECTED_ACCOUNT_ID = accountResult.accountId;
      logSuccess(`Cloudflare Account: ${accountResult.accountName} (${accountResult.accountId})`);
    }

    // Step: 创建 Cloudflare 资源 (生产模式必须，本地模式可选)
    const resourceIds = {};

    if (isProduction) {
      logStep('3/6', '创建 Cloudflare 资源');
      const resourceErrors = [];
      logInfo('Will ensure required resources (check first, create only if missing):');
      if (requiredResources.needsD1) {
        logInfo('- D1: skillscat-db');
      }
      if (requiredResources.needsR2) {
        logInfo('- R2: skillscat-storage');
      }
      if (requiredResources.needsKV) {
        logInfo('- KV: skillscat-kv');
      }
      if (requiredResources.needsQueues) {
        logInfo('- Queues: skillscat-indexing, skillscat-classification, skillscat-security-analysis, skillscat-metrics, skillscat-indexing-dlq, skillscat-classification-dlq, skillscat-security-analysis-dlq, skillscat-metrics-dlq');
      }

      if (requiredResources.needsD1) {
        const d1Result = await createD1Database('skillscat-db');
        if (d1Result.success && d1Result.id) {
          resourceIds.databaseId = d1Result.id;
          logSuccess(`D1 Database: ${d1Result.id}`);
        } else {
          const error = `Failed to create D1 database: ${d1Result.error || 'database id missing'}`;
          resourceErrors.push(error);
          logError(error);
        }
      }

      if (requiredResources.needsR2) {
        const r2Result = await createR2Bucket('skillscat-storage');
        if (r2Result.success) {
          logSuccess('R2 Bucket: skillscat-storage');
        } else {
          const error = `Failed to create R2 bucket: ${r2Result.error}`;
          resourceErrors.push(error);
          logError(error);
        }
      }

      if (requiredResources.needsKV) {
        const kvResult = await createKVNamespace('skillscat-kv');
        if (kvResult.success && kvResult.id) {
          resourceIds.kvId = kvResult.id;
          logSuccess(`KV Namespace: ${kvResult.id}`);
        } else {
          const error = `Failed to create KV namespace: ${kvResult.error || 'namespace id missing'}`;
          resourceErrors.push(error);
          logError(error);
        }
      }

      if (requiredResources.needsQueues) {
        const queues = [
          'skillscat-indexing',
          'skillscat-classification',
          'skillscat-security-analysis',
          'skillscat-metrics',
          'skillscat-indexing-dlq',
          'skillscat-classification-dlq',
          'skillscat-security-analysis-dlq',
          'skillscat-metrics-dlq',
        ];

        for (const queue of queues) {
          const queueResult = await createQueue(queue);
          if (queueResult.success) {
            logSuccess(`Queue: ${queue}`);
          } else {
            const error = `Failed to create queue ${queue}: ${queueResult.error}`;
            resourceErrors.push(error);
            logError(error);
          }
        }
      }

      if (resourceErrors.length > 0) {
        logError('Production initialization aborted due to Cloudflare resource errors');
        process.exit(1);
      }
    }

    // Step: 复制 wrangler 配置文件
    logStep(isProduction ? '4/6' : '1/5', '复制 Wrangler 配置文件');

    const { copied, skipped } = copyWranglerConfigs(selectedConfigFiles, force);

    for (const file of copied) {
      logSuccess(`Created ${file}`);
    }
    for (const file of skipped) {
      logWarning(`Skipped ${file} (already exists, use --force to overwrite)`);
    }

    logInfo('Enforcing worker runtime settings (workers_dev=false, preview_urls=false, observability.enabled=true)...');
    for (const configFile of selectedConfigFiles) {
      const result = ensureWorkerRuntimeSettings(configFile);
      if (!result.exists) {
        logWarning(`Config file not found: ${configFile}`);
      } else if (result.updated) {
        logSuccess(`Updated runtime settings in ${configFile}`);
      }
    }

    const localPrecomputeEnvUpdates = ensurePrecomputeWorkerEnvVars({
      includeProductionVars: false,
      includePreview: includePreviewWorker,
      includeSearchPrecompute: includeSearchPrecomputeWorker,
    });
    const localPrecomputeVarsUpdated = localPrecomputeEnvUpdates.some((result) => result.exists && result.updated);
    if (localPrecomputeVarsUpdated) {
      logSuccess('Updated local wrangler vars for search/recommend precompute defaults');
    }

    const localIndexNowEnvUpdates = ensureIndexNowEnvVars({
      includeProductionVars: false,
      includePreview: includePreviewWorker,
      includeIndexing: includeIndexingWorker,
    });
    const localIndexNowVarsUpdated = localIndexNowEnvUpdates.some((result) => result.exists && result.updated);
    if (localIndexNowVarsUpdated) {
      logSuccess('Updated local wrangler vars for IndexNow defaults');
    }

    if (isProduction) {
      logInfo('Ensuring [env.production] exists in all wrangler config files...');
      for (const configFile of selectedConfigFiles) {
        const result = ensureProductionEnvSection(configFile);
        if (!result.exists) {
          logWarning(`Config file not found: ${configFile}`);
        } else if (result.added) {
          logSuccess(`Added env.production to ${configFile}`);
        }
      }

      logInfo('Ensuring env.production worker names use *-production...');
      for (const configFile of selectedConfigFiles) {
        const result = ensureProductionWorkerName(configFile);
        if (!result.exists) {
          logWarning(`Config file not found: ${configFile}`);
        } else if (result.updated) {
          logSuccess(`Updated env.production name in ${configFile}`);
        }
      }

      if (SELECTED_ACCOUNT_ID) {
        logInfo('Writing account_id to wrangler config files...');
        for (const configFile of selectedConfigFiles) {
          const result = updateWranglerAccountId(configFile, SELECTED_ACCOUNT_ID);
          if (result.exists && result.updated) {
            logSuccess(`Updated account_id in ${configFile}`);
          }
        }
      }
    }

    // 生产模式: 更新 env.production 中的资源 ID
    if (isProduction && (resourceIds.databaseId || resourceIds.kvId)) {
      logInfo('Updating wrangler config files with resource IDs...');

      for (const configFile of selectedConfigFiles) {
        const result = updateWranglerConfig(configFile, resourceIds, {
          replaceAny: true,
          targetScope: 'production',
        });
        if (!result.exists) {
          logWarning(`Config file not found: ${configFile}`);
        } else if (result.updated) {
          logSuccess(`Updated ${configFile}`);
        } else {
          logWarning(`No resource IDs updated in ${configFile}`);
        }
      }
    }

    // Step: 生成 secrets（按需）
    let betterAuthSecret = '';
    let workerSecret = '';
    if (needsGeneratedSecrets) {
      logStep(isProduction ? '5/6' : '2/5', '生成随机 Secrets');
      if (needsBetterAuthSecret) {
        betterAuthSecret = generateSecret(32);
        logSuccess('Generated BETTER_AUTH_SECRET');
      }
      if (needsWorkerSecret) {
        workerSecret = generateSecret(32);
        logSuccess('Generated WORKER_SECRET');
      }
    } else {
      logStep(isProduction ? '5/6' : '2/5', '生成随机 Secrets');
      logInfo('Skipped (selected workers do not require generated secrets)');
    }

    // Step: 环境变量与 secrets（按需）
    logStep(isProduction ? '5/6' : '3/5', '配置环境变量');

    const existingVars = readExistingDevVars();
    let githubClientId = '';
    let githubClientSecret = '';
    let githubToken = '';
    let openrouterApiKey = '';
    let deepseekApiKey = '';
    let virusTotalApiKey = '';
    let indexNowKey = '';
    let productionAppUrl = '';

    if (!needsEnvInput && !needsSecretSetup) {
      logInfo('Skipped (selected workers do not require env vars or secrets)');
    } else {
      const lines = [];
      if (needsGitHubClientId || needsGitHubClientSecret) {
        lines.push('- GitHub OAuth: https://github.com/settings/developers');
        lines.push(`  Authorization callback URL: ${(isProduction && needsProductionAppUrl) ? 'https://your-domain.com' : 'http://localhost:5173'}/api/auth/callback/github`);
      }
      if (needsGitHubToken) {
        lines.push('- GitHub Token: https://github.com/settings/tokens (需要 public_repo 权限)');
      }
      if (needsOpenRouter) {
        lines.push('- OpenRouter: https://openrouter.ai/keys (可选，用于 AI 分类)');
        lines.push('  注意: 我们只使用免费模型，无需付费');
      }
      if (needsDeepSeek) {
        lines.push('- DeepSeek: https://platform.deepseek.com/api_keys (可选，AI 分类兜底)');
      }
      if (needsVirusTotal) {
        lines.push('- VirusTotal: https://www.virustotal.com/gui/join-us (可选，public API 需要 API Key)');
      }
      if (needsIndexNowKey) {
        lines.push('- IndexNow: https://www.indexnow.org/documentation (可选，用于加速 Bing 等搜索引擎发现)');
      }
      if (lines.length > 0) {
        console.log(`\n${colors.gray}以下变量需要手动配置:\n${lines.join('\n')}${colors.reset}\n`);
      }

      if (DRY_RUN) {
        logDryRun('Skipping interactive env/secrets prompts; using existing values or placeholders.');
        if (needsGitHubClientId) {
          githubClientId = existingVars.GITHUB_CLIENT_ID || '<dry-run-github-client-id>';
        }
        if (needsGitHubClientSecret) {
          githubClientSecret = existingVars.GITHUB_CLIENT_SECRET || '<dry-run-github-client-secret>';
        }
        if (needsGitHubToken) {
          githubToken = existingVars.GITHUB_TOKEN || '<dry-run-github-token>';
        }
        if (needsOpenRouter) {
          openrouterApiKey = existingVars.OPENROUTER_API_KEY || '';
        }
        if (needsDeepSeek) {
          deepseekApiKey = existingVars.DEEPSEEK_API_KEY || '';
        }
        if (needsVirusTotal) {
          virusTotalApiKey = existingVars.VIRUSTOTAL_API_KEY || '';
        }
        if (needsIndexNowKey) {
          indexNowKey = existingVars.INDEXNOW_KEY || '';
        }
        productionAppUrl = (isProduction && needsProductionAppUrl) ? 'https://your-domain.com' : '';
      } else {
        if (needsGitHubClientId) {
          githubClientId = existingVars.GITHUB_CLIENT_ID || await ask(rl, 'GitHub Client ID', '');
        }
        if (needsGitHubClientSecret) {
          githubClientSecret = existingVars.GITHUB_CLIENT_SECRET || await ask(rl, 'GitHub Client Secret', '');
        }
        if (needsGitHubToken) {
          githubToken = existingVars.GITHUB_TOKEN || await ask(rl, 'GitHub Personal Access Token', '');
        }
        if (needsOpenRouter) {
          openrouterApiKey = existingVars.OPENROUTER_API_KEY || await ask(rl, 'OpenRouter API Key (可选，免费模型)', '');
        }
        if (needsDeepSeek) {
          deepseekApiKey = existingVars.DEEPSEEK_API_KEY || await ask(rl, 'DeepSeek API Key (可选，兜底策略)', '');
        }
        if (needsVirusTotal) {
          virusTotalApiKey = existingVars.VIRUSTOTAL_API_KEY || await ask(rl, 'VirusTotal API Key (可选，public API)', '');
        }
        if (needsIndexNowKey) {
          indexNowKey = existingVars.INDEXNOW_KEY || await ask(rl, 'IndexNow Key (可选)', '');
        }
        if (isProduction && needsProductionAppUrl) {
          productionAppUrl = await ask(rl, 'Production PUBLIC_APP_URL', 'https://your-domain.com');
        }
      }

      if (isProduction) {
        if (includePreviewWorker && needsProductionAppUrl) {
          const appUrlUpdate = setProductionPublicAppUrl(productionAppUrl);
          if (appUrlUpdate.exists && appUrlUpdate.updated) {
            logSuccess(`Updated env.production PUBLIC_APP_URL -> ${productionAppUrl}`);
          }
        }

        const previewEnvUpdates = ensurePrecomputeWorkerEnvVars({
          productionAppUrl,
          includePreview: includePreviewWorker,
          includeSearchPrecompute: false,
        });
        const precomputeWorkerEnvUpdates = ensurePrecomputeWorkerEnvVars({
          productionAppUrl,
          includePreview: false,
          includeSearchPrecompute: includeSearchPrecomputeWorker,
        });
        const indexNowEnvUpdates = ensureIndexNowEnvVars({
          productionAppUrl,
          includePreview: includePreviewWorker,
          includeIndexing: includeIndexingWorker,
        });
        const previewRecommendVarsUpdated = previewEnvUpdates.some((result) => result.exists && result.updated);
        const precomputeWorkerVarsUpdated = precomputeWorkerEnvUpdates.some((result) => result.exists && result.updated);
        const indexNowVarsUpdated = indexNowEnvUpdates.some((result) => result.exists && result.updated);
        if (previewRecommendVarsUpdated) {
          logSuccess('Updated preview worker recommend env vars');
        }
        if (precomputeWorkerVarsUpdated) {
          logSuccess('Updated search-precompute worker env vars');
        }
        if (indexNowVarsUpdated) {
          logSuccess('Updated preview/indexing IndexNow env vars');
        }

        if (needsSecretSetup && selectedProductionWorkers.length > 0) {
          const shouldSetSecrets = DRY_RUN
            ? true
            : await askYesNo(rl, 'Set secrets to Cloudflare Workers now?');

          if (shouldSetSecrets) {
            if (DRY_RUN) {
              logDryRun(`Simulating Cloudflare secret writes to ${selectedProductionWorkers.length} worker(s).`);
            }

            const secrets = {};
            if (needsBetterAuthSecret) secrets.BETTER_AUTH_SECRET = betterAuthSecret;
            if (needsWorkerSecret) secrets.WORKER_SECRET = workerSecret;
            if (needsGitHubClientId) secrets.GITHUB_CLIENT_ID = githubClientId;
            if (needsGitHubClientSecret) secrets.GITHUB_CLIENT_SECRET = githubClientSecret;
            if (needsGitHubToken) secrets.GITHUB_TOKEN = githubToken;
            if (needsOpenRouter && openrouterApiKey) secrets.OPENROUTER_API_KEY = openrouterApiKey;
            if (needsDeepSeek && deepseekApiKey) secrets.DEEPSEEK_API_KEY = deepseekApiKey;
            if (needsVirusTotal && virusTotalApiKey) secrets.VIRUSTOTAL_API_KEY = virusTotalApiKey;
            if (needsIndexNowKey && indexNowKey) secrets.INDEXNOW_KEY = indexNowKey;

            const secretErrors = [];
            for (const worker of selectedProductionWorkers) {
              logInfo(`Setting secrets for ${worker}...`);
              for (const [name, value] of Object.entries(secrets)) {
                if (!value) continue;
                const result = await setSecret(worker, name, value, 'production');
                if (!result.success) {
                  const error = `Failed to set ${name} for ${worker}: ${result.error}`;
                  secretErrors.push(error);
                  logError(error);
                }
              }
            }

            if (secretErrors.length > 0) {
              logError('Production initialization aborted due to secret configuration errors');
              process.exit(1);
            }

            logSuccess('Secrets configured');
          } else {
            logInfo('Skipped secrets configuration');
            logInfo('You can set secrets later using: npx wrangler secret put <SECRET_NAME> --name <WORKER_NAME> --env production');
          }
        } else {
          logInfo('Skipped secrets configuration (selected workers do not require secrets)');
        }
      } else if (needsSecretSetup) {
        const devVars = {};
        if (needsBetterAuthSecret) {
          devVars.BETTER_AUTH_SECRET = existingVars.BETTER_AUTH_SECRET || betterAuthSecret;
        }
        if (needsWorkerSecret) {
          devVars.WORKER_SECRET = existingVars.WORKER_SECRET || workerSecret;
        }
        if (needsGitHubClientId) {
          devVars.GITHUB_CLIENT_ID = githubClientId || 'your-github-client-id';
        }
        if (needsGitHubClientSecret) {
          devVars.GITHUB_CLIENT_SECRET = githubClientSecret || 'your-github-client-secret';
        }
        if (needsGitHubToken) {
          devVars.GITHUB_TOKEN = githubToken || 'your-github-token';
        }
        if (needsOpenRouter) {
          devVars.OPENROUTER_API_KEY = openrouterApiKey || '';
        }
        if (needsDeepSeek) {
          devVars.DEEPSEEK_API_KEY = deepseekApiKey || '';
        }
        if (needsVirusTotal) {
          devVars.VIRUSTOTAL_API_KEY = virusTotalApiKey || '';
        }
        if (needsIndexNowKey) {
          devVars.INDEXNOW_KEY = indexNowKey || '';
        }

        const devVarsResult = createDevVars(devVars, force);
        if (devVarsResult.created) {
          logSuccess('.dev.vars updated for selected workers');
        } else {
          logWarning('.dev.vars already exists (use --force to overwrite)');
        }
      } else {
        logInfo('Skipped .dev.vars update (selected workers do not require secrets)');
      }
    }

    // 本地模式: 可选创建 Cloudflare 资源
    if (!isProduction && !localOnly) {
      logStep('4/5', '创建 Cloudflare 资源 (可选)');

      if (DRY_RUN) {
        logDryRun('Skipping optional Cloudflare resource creation flow in local mode.');
      } else {
        // 检查 wrangler CLI
        if (!checkWranglerCLI()) {
          logWarning('Wrangler CLI not found, skipping Cloudflare resource creation');
          logInfo('Run "npx wrangler login" to authenticate');
        } else if (!checkCloudflareAuth()) {
          logWarning('Not logged in to Cloudflare');
          const shouldLogin = await askYesNo(rl, 'Do you want to login now?');
          if (shouldLogin) {
            console.log('\nOpening browser for Cloudflare login...\n');
            execSync('npx wrangler login', { stdio: 'inherit' });
          } else {
            logInfo('Skipping Cloudflare resource creation');
          }
        }

        if (checkCloudflareAuth()) {
          const shouldCreate = await askYesNo(rl, 'Create Cloudflare resources (D1, R2, KV, Queues)?');

          if (shouldCreate) {
            if (requiredResources.needsD1) {
              const d1Result = await createD1Database('skillscat-db');
              if (d1Result.success && d1Result.id) {
                resourceIds.databaseId = d1Result.id;
                logSuccess(`D1 Database created: ${d1Result.id}`);
              } else {
                logError(`Failed to create D1 database: ${d1Result.error}`);
              }
            }

            if (requiredResources.needsR2) {
              const r2Result = await createR2Bucket('skillscat-storage');
              if (r2Result.success) {
                logSuccess('R2 Bucket created: skillscat-storage');
              } else {
                logError(`Failed to create R2 bucket: ${r2Result.error}`);
              }
            }

            if (requiredResources.needsKV) {
              const kvResult = await createKVNamespace('skillscat-kv');
              if (kvResult.success && kvResult.id) {
                resourceIds.kvId = kvResult.id;
                logSuccess(`KV Namespace created: ${kvResult.id}`);
              } else {
                logError(`Failed to create KV namespace: ${kvResult.error}`);
              }
            }

            if (requiredResources.needsQueues) {
              const indexingQueueResult = await createQueue('skillscat-indexing');
              if (indexingQueueResult.success) {
                logSuccess('Queue created: skillscat-indexing');
              } else {
                logError(`Failed to create indexing queue: ${indexingQueueResult.error}`);
              }

              const classificationQueueResult = await createQueue('skillscat-classification');
              if (classificationQueueResult.success) {
                logSuccess('Queue created: skillscat-classification');
              } else {
                logError(`Failed to create classification queue: ${classificationQueueResult.error}`);
              }

              const securityAnalysisQueueResult = await createQueue('skillscat-security-analysis');
              if (securityAnalysisQueueResult.success) {
                logSuccess('Queue created: skillscat-security-analysis');
              } else {
                logError(`Failed to create security analysis queue: ${securityAnalysisQueueResult.error}`);
              }

              const metricsQueueResult = await createQueue('skillscat-metrics');
              if (metricsQueueResult.success) {
                logSuccess('Queue created: skillscat-metrics');
              } else {
                logError(`Failed to create metrics queue: ${metricsQueueResult.error}`);
              }

              await createQueue('skillscat-indexing-dlq');
              await createQueue('skillscat-classification-dlq');
              await createQueue('skillscat-security-analysis-dlq');
              await createQueue('skillscat-metrics-dlq');
            }

            // 更新 wrangler 配置文件
            if (resourceIds.databaseId || resourceIds.kvId) {
              logInfo('Updating wrangler config files...');

              for (const configFile of selectedConfigFiles) {
                const result = updateWranglerConfig(configFile, resourceIds, {
                  replaceLocal: true,
                  targetScope: 'top',
                });
                if (result.exists && result.updated) {
                  logSuccess(`Updated ${configFile}`);
                }
              }
            }
          } else {
            logInfo('Skipped Cloudflare resource creation');
          }
        }
      }
    } else if (localOnly) {
      logStep('4/5', '创建 Cloudflare 资源');
      logInfo('Skipped (--local mode)');
    }

    // Step: 完成
    logStep(isProduction ? '6/6' : '5/5', '初始化完成');

    if (isProduction) {
      console.log(`
${colors.green}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bold}线上环境初始化完成!${colors.green}                                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bold}资源 ID:${colors.reset}
  Database ID: ${colors.cyan}${resourceIds.databaseId || 'N/A'}${colors.reset}
  KV ID: ${colors.cyan}${resourceIds.kvId || 'N/A'}${colors.reset}

${colors.bold}下一步:${colors.reset}

1. 检查 ${colors.cyan}apps/web/wrangler.*.toml${colors.reset} 文件中的配置
2. 运行 ${colors.cyan}pnpm db:migrate:prod${colors.reset} 执行数据库迁移
3. 运行 ${colors.cyan}pnpm deploy${colors.reset} 部署主服务 (wrangler.preview.toml --env production)
4. 运行 ${colors.cyan}pnpm deploy:workers${colors.reset} 部署所有 workers (wrangler.*.toml --env production)

${colors.gray}本地开发环境配置请运行: pnpm init:project${colors.reset}
${colors.gray}更多信息请查看 CLAUDE.md${colors.reset}
`);
    } else {
      console.log(`
${colors.green}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bold}本地开发环境初始化完成!${colors.green}                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bold}下一步:${colors.reset}

1. 检查并完善 ${colors.cyan}apps/web/.dev.vars${colors.reset} 中的配置
2. 检查 ${colors.cyan}apps/web/wrangler.*.toml${colors.reset} 文件中的资源 ID
3. 运行 ${colors.cyan}pnpm install${colors.reset} 安装依赖
4. 运行 ${colors.cyan}pnpm dev${colors.reset} 启动开发服务器

${colors.gray}线上环境配置请运行: pnpm init:project --production${colors.reset}
${colors.gray}更多信息请查看 CLAUDE.md${colors.reset}
`);
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`${colors.red}Error:${colors.reset}`, error.message);
  process.exit(1);
});
