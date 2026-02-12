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

// Workers 列表 (用于生产环境设置 secrets)
const WORKERS = [
  'skillscat-web-production',
  'skillscat-github-events-production',
  'skillscat-indexing-production',
  'skillscat-classification-production',
  'skillscat-trending-production',
  'skillscat-tier-recalc-production',
  'skillscat-archive-production',
  'skillscat-resurrection-production',
];

const PRODUCTION_WORKER_NAMES = {
  'wrangler.preview.toml': 'skillscat-web-production',
  'wrangler.github-events.toml': 'skillscat-github-events-production',
  'wrangler.indexing.toml': 'skillscat-indexing-production',
  'wrangler.classification.toml': 'skillscat-classification-production',
  'wrangler.trending.toml': 'skillscat-trending-production',
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
  'wrangler.trending.toml',
  'wrangler.tier-recalc.toml',
  'wrangler.archive.toml',
  'wrangler.resurrection.toml',
];

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
 * @param {boolean} force - 强制覆盖
 */
function copyWranglerConfigs(force = false) {
  const copied = [];
  const skipped = [];

  for (const config of CONFIG_FILES) {
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

[env.production.vars]
PUBLIC_APP_URL = "https://your-domain.com"
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

[env.production.vars]
GITHUB_API_VERSION = "2022-11-28"
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

[env.production.vars]
TRENDING_DECAY_HOURS = "72"
TRENDING_STAR_WEIGHT = "1.0"
TRENDING_FORK_WEIGHT = "2.0"
TRENDING_VIEW_WEIGHT = "0.1"
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
      logInfo('- D1: skillscat-db');
      logInfo('- R2: skillscat-storage');
      logInfo('- KV: skillscat-kv');
      logInfo('- Queues: skillscat-indexing, skillscat-classification, skillscat-indexing-dlq, skillscat-classification-dlq');

      // D1 Database
      const d1Result = await createD1Database('skillscat-db');
      if (d1Result.success && d1Result.id) {
        resourceIds.databaseId = d1Result.id;
        logSuccess(`D1 Database: ${d1Result.id}`);
      } else {
        const error = `Failed to create D1 database: ${d1Result.error || 'database id missing'}`;
        resourceErrors.push(error);
        logError(error);
      }

      // R2 Bucket
      const r2Result = await createR2Bucket('skillscat-storage');
      if (r2Result.success) {
        logSuccess(`R2 Bucket: skillscat-storage`);
      } else {
        const error = `Failed to create R2 bucket: ${r2Result.error}`;
        resourceErrors.push(error);
        logError(error);
      }

      // KV Namespace
      const kvResult = await createKVNamespace('skillscat-kv');
      if (kvResult.success && kvResult.id) {
        resourceIds.kvId = kvResult.id;
        logSuccess(`KV Namespace: ${kvResult.id}`);
      } else {
        const error = `Failed to create KV namespace: ${kvResult.error || 'namespace id missing'}`;
        resourceErrors.push(error);
        logError(error);
      }

      // Queues
      const queues = [
        'skillscat-indexing',
        'skillscat-classification',
        'skillscat-indexing-dlq',
        'skillscat-classification-dlq',
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

      if (resourceErrors.length > 0) {
        logError('Production initialization aborted due to Cloudflare resource errors');
        process.exit(1);
      }
    }

    // Step: 复制 wrangler 配置文件
    logStep(isProduction ? '4/6' : '1/5', '复制 Wrangler 配置文件');

    const { copied, skipped } = copyWranglerConfigs(force);

    for (const file of copied) {
      logSuccess(`Created ${file}`);
    }
    for (const file of skipped) {
      logWarning(`Skipped ${file} (already exists, use --force to overwrite)`);
    }

    if (isProduction) {
      logInfo('Ensuring [env.production] exists in all wrangler config files...');
      for (const configFile of CONFIG_FILES) {
        const result = ensureProductionEnvSection(configFile);
        if (!result.exists) {
          logWarning(`Config file not found: ${configFile}`);
        } else if (result.added) {
          logSuccess(`Added env.production to ${configFile}`);
        }
      }

      logInfo('Ensuring env.production worker names use *-production...');
      for (const configFile of CONFIG_FILES) {
        const result = ensureProductionWorkerName(configFile);
        if (!result.exists) {
          logWarning(`Config file not found: ${configFile}`);
        } else if (result.updated) {
          logSuccess(`Updated env.production name in ${configFile}`);
        }
      }

      if (SELECTED_ACCOUNT_ID) {
        logInfo('Writing account_id to wrangler config files...');
        for (const configFile of CONFIG_FILES) {
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

      for (const configFile of CONFIG_FILES) {
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

    // Step: 生成 secrets
    logStep(isProduction ? '5/6' : '2/5', '生成随机 Secrets');

    const betterAuthSecret = generateSecret(32);
    const workerSecret = generateSecret(32);

    logSuccess(`Generated BETTER_AUTH_SECRET`);
    logSuccess(`Generated WORKER_SECRET`);

    // Step: 收集用户输入的 secrets
    logStep(isProduction ? '5/6' : '3/5', '配置环境变量');

    // Read existing .dev.vars to preserve configured values
    const existingVars = readExistingDevVars();

    console.log(`
${colors.gray}以下变量需要手动配置:
- GitHub OAuth: https://github.com/settings/developers
  Authorization callback URL: ${isProduction ? 'https://your-domain.com' : 'http://localhost:5173'}/api/auth/callback/github
- GitHub Token: https://github.com/settings/tokens (需要 public_repo 权限)
- OpenRouter: https://openrouter.ai/keys (可选，用于 AI 分类)
  注意: 我们只使用免费模型，无需付费
- DeepSeek: https://platform.deepseek.com/api_keys (可选，AI 分类兜底)${colors.reset}
`);

    let githubClientId = '';
    let githubClientSecret = '';
    let githubToken = '';
    let openrouterApiKey = '';
    let deepseekApiKey = '';
    let productionAppUrl = '';

    if (DRY_RUN) {
      logDryRun('Skipping interactive env/secrets prompts; using existing values or placeholders.');
      githubClientId = existingVars.GITHUB_CLIENT_ID || '<dry-run-github-client-id>';
      githubClientSecret = existingVars.GITHUB_CLIENT_SECRET || '<dry-run-github-client-secret>';
      githubToken = existingVars.GITHUB_TOKEN || '<dry-run-github-token>';
      openrouterApiKey = existingVars.OPENROUTER_API_KEY || '';
      deepseekApiKey = existingVars.DEEPSEEK_API_KEY || '';
      productionAppUrl = isProduction ? 'https://your-domain.com' : '';
    } else {
      // Only prompt for values that are not already configured
      githubClientId = existingVars.GITHUB_CLIENT_ID || await ask(rl, 'GitHub Client ID', '');
      githubClientSecret = existingVars.GITHUB_CLIENT_SECRET || await ask(rl, 'GitHub Client Secret', '');
      githubToken = existingVars.GITHUB_TOKEN || await ask(rl, 'GitHub Personal Access Token', '');
      openrouterApiKey = existingVars.OPENROUTER_API_KEY || await ask(rl, 'OpenRouter API Key (可选，免费模型)', '');
      deepseekApiKey = existingVars.DEEPSEEK_API_KEY || await ask(rl, 'DeepSeek API Key (可选，兜底策略)', '');
      productionAppUrl = isProduction
        ? await ask(rl, 'Production PUBLIC_APP_URL', 'https://your-domain.com')
        : '';
    }

    if (isProduction) {
      const appUrlUpdate = setProductionPublicAppUrl(productionAppUrl);
      if (appUrlUpdate.exists && appUrlUpdate.updated) {
        logSuccess(`Updated env.production PUBLIC_APP_URL -> ${productionAppUrl}`);
      }

      // 生产模式: 设置 Cloudflare secrets
      const shouldSetSecrets = DRY_RUN
        ? true
        : await askYesNo(rl, 'Set secrets to Cloudflare Workers now?');

      if (shouldSetSecrets) {
        if (DRY_RUN) {
          logDryRun('Simulating Cloudflare secret writes to all workers.');
        }

        const secrets = {
          BETTER_AUTH_SECRET: betterAuthSecret,
          WORKER_SECRET: workerSecret,
          GITHUB_CLIENT_ID: githubClientId,
          GITHUB_CLIENT_SECRET: githubClientSecret,
          GITHUB_TOKEN: githubToken,
        };

        if (openrouterApiKey) secrets.OPENROUTER_API_KEY = openrouterApiKey;
        if (deepseekApiKey) secrets.DEEPSEEK_API_KEY = deepseekApiKey;

        // 为每个 worker 设置 secrets
        const secretErrors = [];
        for (const worker of WORKERS) {
          logInfo(`Setting secrets for ${worker}...`);
          for (const [name, value] of Object.entries(secrets)) {
            if (value) {
              const result = await setSecret(worker, name, value, 'production');
              if (!result.success) {
                const error = `Failed to set ${name} for ${worker}: ${result.error}`;
                secretErrors.push(error);
                logError(error);
              }
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
      // 本地模式: 创建 .dev.vars
      const devVars = {
        BETTER_AUTH_SECRET: existingVars.BETTER_AUTH_SECRET || betterAuthSecret,
        WORKER_SECRET: existingVars.WORKER_SECRET || workerSecret,
        GITHUB_CLIENT_ID: githubClientId || 'your-github-client-id',
        GITHUB_CLIENT_SECRET: githubClientSecret || 'your-github-client-secret',
        GITHUB_TOKEN: githubToken || 'your-github-token',
        OPENROUTER_API_KEY: openrouterApiKey || '',
        DEEPSEEK_API_KEY: deepseekApiKey || '',
      };

      const devVarsResult = createDevVars(devVars, force);
      if (devVarsResult.created) {
        logSuccess(`Created .dev.vars`);
      } else {
        logWarning(`.dev.vars already exists (use --force to overwrite)`);
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
            // D1 Database
            const d1Result = await createD1Database('skillscat-db');
            if (d1Result.success && d1Result.id) {
              resourceIds.databaseId = d1Result.id;
              logSuccess(`D1 Database created: ${d1Result.id}`);
            } else {
              logError(`Failed to create D1 database: ${d1Result.error}`);
            }

            // R2 Bucket
            const r2Result = await createR2Bucket('skillscat-storage');
            if (r2Result.success) {
              logSuccess(`R2 Bucket created: skillscat-storage`);
            } else {
              logError(`Failed to create R2 bucket: ${r2Result.error}`);
            }

            // KV Namespace
            const kvResult = await createKVNamespace('skillscat-kv');
            if (kvResult.success && kvResult.id) {
              resourceIds.kvId = kvResult.id;
              logSuccess(`KV Namespace created: ${kvResult.id}`);
            } else {
              logError(`Failed to create KV namespace: ${kvResult.error}`);
            }

            // Queues
            const indexingQueueResult = await createQueue('skillscat-indexing');
            if (indexingQueueResult.success) {
              logSuccess(`Queue created: skillscat-indexing`);
            } else {
              logError(`Failed to create indexing queue: ${indexingQueueResult.error}`);
            }

            const classificationQueueResult = await createQueue('skillscat-classification');
            if (classificationQueueResult.success) {
              logSuccess(`Queue created: skillscat-classification`);
            } else {
              logError(`Failed to create classification queue: ${classificationQueueResult.error}`);
            }

            // Dead letter queues
            await createQueue('skillscat-indexing-dlq');
            await createQueue('skillscat-classification-dlq');

            // 更新 wrangler 配置文件
            if (resourceIds.databaseId || resourceIds.kvId) {
              logInfo('Updating wrangler config files...');

              for (const configFile of CONFIG_FILES) {
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
