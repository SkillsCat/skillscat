#!/usr/bin/env node

/**
 * SkillsCat 线上环境初始化脚本
 *
 * 功能:
 * 1. 创建 Cloudflare 资源 (D1, R2, KV, Queues)
 * 2. 生成线上环境的 wrangler 配置文件
 * 3. 设置 Cloudflare secrets
 *
 * Usage:
 *   pnpm init:production           # 交互式初始化线上环境
 *   pnpm init:production --force   # 强制覆盖现有配置
 *
 * 注意: 本地开发环境配置请使用 pnpm init:project
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const WEB_DIR = resolve(ROOT_DIR, 'apps/web');

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

/**
 * 生成随机 secret
 */
function generateSecret(length = 32) {
  return randomBytes(length).toString('base64url').slice(0, length);
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

/**
 * 执行 wrangler 命令并返回输出
 */
function runWrangler(args, options = {}) {
  try {
    const result = execSync(`npx wrangler ${args}`, {
      cwd: WEB_DIR,
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 创建 Cloudflare D1 数据库
 */
async function createD1Database(name) {
  logInfo(`Creating D1 database: ${name}`);
  const result = runWrangler(`d1 create ${name}`, { silent: true, stdio: 'pipe' });

  if (!result.success) {
    if (result.error?.includes('already exists')) {
      logWarning(`Database ${name} already exists`);
      const listResult = runWrangler('d1 list --json', { silent: true, stdio: 'pipe' });
      if (listResult.success) {
        try {
          const databases = JSON.parse(listResult.output);
          const db = databases.find((d) => d.name === name);
          if (db) {
            return { success: true, id: db.uuid };
          }
        } catch {}
      }
    }
    return { success: false, error: result.error };
  }

  const idMatch = result.output?.match(/database_id\s*=\s*"([^"]+)"/);
  const id = idMatch ? idMatch[1] : null;

  return { success: true, id };
}

/**
 * 创建 Cloudflare R2 bucket
 */
async function createR2Bucket(name) {
  logInfo(`Creating R2 bucket: ${name}`);
  const result = runWrangler(`r2 bucket create ${name}`, { silent: true, stdio: 'pipe' });

  if (!result.success) {
    if (result.error?.includes('already exists')) {
      logWarning(`Bucket ${name} already exists`);
      return { success: true, name };
    }
    return { success: false, error: result.error };
  }

  return { success: true, name };
}

/**
 * 创建 Cloudflare KV namespace
 */
async function createKVNamespace(title) {
  logInfo(`Creating KV namespace: ${title}`);
  const result = runWrangler(`kv namespace create "${title}"`, { silent: true, stdio: 'pipe' });

  if (!result.success) {
    if (result.error?.includes('already exists')) {
      logWarning(`KV namespace ${title} already exists`);
      const listResult = runWrangler('kv namespace list --json', { silent: true, stdio: 'pipe' });
      if (listResult.success) {
        try {
          const namespaces = JSON.parse(listResult.output);
          const ns = namespaces.find((n) => n.title.includes(title));
          if (ns) {
            return { success: true, id: ns.id };
          }
        } catch {}
      }
    }
    return { success: false, error: result.error };
  }

  const idMatch = result.output?.match(/id\s*=\s*"([^"]+)"/);
  const id = idMatch ? idMatch[1] : null;

  return { success: true, id };
}

/**
 * 创建 Cloudflare Queue
 */
async function createQueue(name) {
  logInfo(`Creating Queue: ${name}`);
  const result = runWrangler(`queues create ${name}`, { silent: true, stdio: 'pipe' });

  if (!result.success) {
    if (result.error?.includes('already exists')) {
      logWarning(`Queue ${name} already exists`);
      return { success: true, name };
    }
    return { success: false, error: result.error };
  }

  return { success: true, name };
}

/**
 * 设置 Cloudflare secret
 */
async function setSecret(workerName, secretName, secretValue) {
  logInfo(`Setting secret ${secretName} for ${workerName}`);
  try {
    execSync(`echo "${secretValue}" | npx wrangler secret put ${secretName} --name ${workerName}`, {
      cwd: WEB_DIR,
      stdio: 'pipe',
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 从 example 文件生成线上配置
 */
function generateProductionConfig(configFile, resourceIds) {
  const examplePath = resolve(WEB_DIR, `${configFile}.example`);
  const targetPath = resolve(WEB_DIR, configFile);

  if (!existsSync(examplePath)) {
    return { success: false, error: 'Example file not found' };
  }

  let content = readFileSync(examplePath, 'utf-8');

  // 替换资源 ID
  if (resourceIds.databaseId) {
    content = content.replace(/<your-database-id>/g, resourceIds.databaseId);
  }
  if (resourceIds.kvId) {
    content = content.replace(/<your-kv-namespace-id>/g, resourceIds.kvId);
  }

  writeFileSync(targetPath, content);
  return { success: true };
}

// Workers 列表
const WORKERS = [
  'skillscat-web',
  'skillscat-github-events',
  'skillscat-indexing',
  'skillscat-classification',
  'skillscat-trending',
  'skillscat-tier-recalc',
  'skillscat-archive',
  'skillscat-resurrection',
];

// 配置文件列表
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

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bold}SkillsCat 线上环境初始化${colors.cyan}                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

  const rl = createReadline();

  try {
    // Step 1: 检查 wrangler CLI 和认证
    logStep('1/5', '检查 Cloudflare 认证');

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

    // Step 2: 创建 Cloudflare 资源
    logStep('2/5', '创建 Cloudflare 资源');

    const resourceIds = {};

    // D1 Database
    const d1Result = await createD1Database('skillscat-db');
    if (d1Result.success && d1Result.id) {
      resourceIds.databaseId = d1Result.id;
      logSuccess(`D1 Database: ${d1Result.id}`);
    } else {
      logError(`Failed to create D1 database: ${d1Result.error}`);
    }

    // R2 Bucket
    const r2Result = await createR2Bucket('skillscat-storage');
    if (r2Result.success) {
      logSuccess(`R2 Bucket: skillscat-storage`);
    } else {
      logError(`Failed to create R2 bucket: ${r2Result.error}`);
    }

    // KV Namespace
    const kvResult = await createKVNamespace('skillscat-kv');
    if (kvResult.success && kvResult.id) {
      resourceIds.kvId = kvResult.id;
      logSuccess(`KV Namespace: ${kvResult.id}`);
    } else {
      logError(`Failed to create KV namespace: ${kvResult.error}`);
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
        logError(`Failed to create queue ${queue}: ${queueResult.error}`);
      }
    }

    // Step 3: 生成配置文件
    logStep('3/5', '生成 Wrangler 配置文件');

    for (const configFile of CONFIG_FILES) {
      const examplePath = resolve(WEB_DIR, `${configFile}.example`);
      const targetPath = resolve(WEB_DIR, configFile);

      if (!existsSync(examplePath)) {
        logWarning(`Example file not found: ${configFile}.example`);
        continue;
      }

      if (existsSync(targetPath) && !force) {
        logWarning(`Skipped ${configFile} (already exists, use --force to overwrite)`);
        continue;
      }

      const result = generateProductionConfig(configFile, resourceIds);
      if (result.success) {
        logSuccess(`Generated ${configFile}`);
      } else {
        logError(`Failed to generate ${configFile}: ${result.error}`);
      }
    }

    // Step 4: 配置 Secrets
    logStep('4/5', '配置 Cloudflare Secrets');

    console.log(`
${colors.gray}以下 secrets 需要配置到 Cloudflare:
- BETTER_AUTH_SECRET: 认证密钥 (自动生成)
- WORKER_SECRET: Worker 间通信密钥 (自动生成)
- GITHUB_CLIENT_ID/SECRET: GitHub OAuth
- GITHUB_TOKEN: GitHub API Token
- OPENROUTER_API_KEY: OpenRouter API (可选，用于 AI 分类，只使用免费模型)${colors.reset}
`);

    const shouldSetSecrets = await askYesNo(rl, 'Do you want to set secrets now?');

    if (shouldSetSecrets) {
      // 生成随机 secrets
      const betterAuthSecret = generateSecret(32);
      const workerSecret = generateSecret(32);

      logInfo('Generated BETTER_AUTH_SECRET and WORKER_SECRET');

      // 收集用户输入
      const githubClientId = await ask(rl, 'GitHub Client ID');
      const githubClientSecret = await ask(rl, 'GitHub Client Secret');
      const githubToken = await ask(rl, 'GitHub Personal Access Token');
      const openrouterApiKey = await ask(rl, 'OpenRouter API Key (可选，免费模型)', '');

      const secrets = {
        BETTER_AUTH_SECRET: betterAuthSecret,
        WORKER_SECRET: workerSecret,
        GITHUB_CLIENT_ID: githubClientId,
        GITHUB_CLIENT_SECRET: githubClientSecret,
        GITHUB_TOKEN: githubToken,
      };

      if (openrouterApiKey) secrets.OPENROUTER_API_KEY = openrouterApiKey;

      // 为每个 worker 设置 secrets
      for (const worker of WORKERS) {
        logInfo(`Setting secrets for ${worker}...`);
        for (const [name, value] of Object.entries(secrets)) {
          if (value) {
            await setSecret(worker, name, value);
          }
        }
      }

      logSuccess('Secrets configured');
    } else {
      logInfo('Skipped secrets configuration');
      logInfo('You can set secrets later using: npx wrangler secret put <SECRET_NAME> --name <WORKER_NAME>');
    }

    // Step 5: 完成
    logStep('5/5', '初始化完成');

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
2. 运行 ${colors.cyan}pnpm db:migrate${colors.reset} 执行数据库迁移
3. 运行 ${colors.cyan}pnpm deploy${colors.reset} 部署所有 Workers

${colors.gray}本地开发环境配置请运行: pnpm init:project${colors.reset}
${colors.gray}更多信息请查看 CLAUDE.md${colors.reset}
`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`${colors.red}Error:${colors.reset}`, error.message);
  process.exit(1);
});
