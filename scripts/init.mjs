#!/usr/bin/env node

/**
 * SkillsCat 项目初始化脚本
 *
 * 功能:
 * 1. 复制 wrangler.*.toml.example 到 wrangler.*.toml
 * 2. 创建 .dev.vars 文件并生成随机 secrets
 * 3. 可选: 使用 wrangler CLI 创建 Cloudflare 资源
 * 4. 更新 wrangler.toml 文件中的资源 ID
 *
 * Usage:
 *   pnpm init:project           # 交互式初始化
 *   pnpm init:project --local   # 仅本地配置 (不创建 Cloudflare 资源)
 *   pnpm init:project --force   # 强制覆盖现有配置
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

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

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
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
      cwd: ROOT_DIR,
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
 * 从 wrangler 输出中提取 ID
 */
function extractIdFromOutput(output, pattern) {
  const match = output.match(pattern);
  return match ? match[1] : null;
}

/**
 * 复制 wrangler 配置文件
 */
function copyWranglerConfigs(force = false) {
  const configs = [
    'wrangler.web.toml',
    'wrangler.github-events.toml',
    'wrangler.indexing.toml',
    'wrangler.classification.toml',
    'wrangler.trending.toml',
  ];

  const copied = [];
  const skipped = [];

  for (const config of configs) {
    const examplePath = resolve(ROOT_DIR, `${config}.example`);
    const targetPath = resolve(ROOT_DIR, config);

    if (!existsSync(examplePath)) {
      logWarning(`Example file not found: ${config}.example`);
      continue;
    }

    if (existsSync(targetPath) && !force) {
      skipped.push(config);
      continue;
    }

    copyFileSync(examplePath, targetPath);
    copied.push(config);
  }

  return { copied, skipped };
}

/**
 * 创建 .dev.vars 文件
 */
function createDevVars(vars, force = false) {
  const devVarsPath = resolve(ROOT_DIR, '.dev.vars');

  if (existsSync(devVarsPath) && !force) {
    return { created: false, path: devVarsPath };
  }

  const content = Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync(devVarsPath, content + '\n');
  return { created: true, path: devVarsPath };
}

/**
 * 更新 wrangler.toml 文件中的值
 */
function updateWranglerConfig(configFile, updates) {
  const configPath = resolve(ROOT_DIR, configFile);

  if (!existsSync(configPath)) {
    return false;
  }

  let content = readFileSync(configPath, 'utf-8');

  for (const [placeholder, value] of Object.entries(updates)) {
    content = content.replace(new RegExp(placeholder, 'g'), value);
  }

  writeFileSync(configPath, content);
  return true;
}

/**
 * 创建 Cloudflare D1 数据库
 */
async function createD1Database(name) {
  logInfo(`Creating D1 database: ${name}`);
  const result = runWrangler(`d1 create ${name}`, { silent: true, stdio: 'pipe' });

  if (!result.success) {
    // 检查是否已存在
    if (result.error?.includes('already exists')) {
      logWarning(`Database ${name} already exists`);
      // 尝试获取现有数据库 ID
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

  // 从输出中提取 database_id
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
      // 尝试获取现有 namespace ID
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

  // 从输出中提取 id
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
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const localOnly = args.includes('--local');
  const force = args.includes('--force');

  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bold}SkillsCat 项目初始化${colors.cyan}                                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);

  const rl = createReadline();

  try {
    // Step 1: 复制 wrangler 配置文件
    logStep('1/5', '复制 Wrangler 配置文件');

    const { copied, skipped } = copyWranglerConfigs(force);

    for (const file of copied) {
      logSuccess(`Created ${file}`);
    }
    for (const file of skipped) {
      logWarning(`Skipped ${file} (already exists, use --force to overwrite)`);
    }

    // Step 2: 生成 secrets
    logStep('2/5', '生成随机 Secrets');

    const betterAuthSecret = generateSecret(32);
    const workerSecret = generateSecret(32);

    logSuccess(`Generated BETTER_AUTH_SECRET`);
    logSuccess(`Generated WORKER_SECRET`);

    // Step 3: 收集用户输入的 secrets
    logStep('3/5', '配置环境变量');

    console.log(`
${colors.gray}以下变量需要手动配置 (可以稍后在 .dev.vars 中修改):
- GitHub OAuth: https://github.com/settings/developers
- GitHub Token: https://github.com/settings/tokens
- Google OAuth: https://console.cloud.google.com/apis/credentials
- OpenRouter: https://openrouter.ai/keys
- DeepSeek: https://platform.deepseek.com/api_keys${colors.reset}
`);

    const githubClientId = await ask(rl, 'GitHub Client ID', '');
    const githubClientSecret = await ask(rl, 'GitHub Client Secret', '');
    const githubToken = await ask(rl, 'GitHub Personal Access Token', '');
    const googleClientId = await ask(rl, 'Google Client ID (可选)', '');
    const googleClientSecret = await ask(rl, 'Google Client Secret (可选)', '');
    const openrouterApiKey = await ask(rl, 'OpenRouter API Key (可选)', '');
    const deepseekApiKey = await ask(rl, 'DeepSeek API Key (可选)', '');

    // 创建 .dev.vars
    const devVars = {
      BETTER_AUTH_SECRET: betterAuthSecret,
      WORKER_SECRET: workerSecret,
      GITHUB_CLIENT_ID: githubClientId || 'your-github-client-id',
      GITHUB_CLIENT_SECRET: githubClientSecret || 'your-github-client-secret',
      GITHUB_TOKEN: githubToken || 'your-github-token',
      GOOGLE_CLIENT_ID: googleClientId || '',
      GOOGLE_CLIENT_SECRET: googleClientSecret || '',
      OPENROUTER_API_KEY: openrouterApiKey || '',
      DEEPSEEK_API_KEY: deepseekApiKey || '',
    };

    const devVarsResult = createDevVars(devVars, force);
    if (devVarsResult.created) {
      logSuccess(`Created .dev.vars`);
    } else {
      logWarning(`.dev.vars already exists (use --force to overwrite)`);
    }

    // Step 4: 创建 Cloudflare 资源 (可选)
    logStep('4/5', '创建 Cloudflare 资源');

    if (localOnly) {
      logInfo('Skipped (--local mode)');
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
          const resourceIds = {};

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

            const updates = {};
            if (resourceIds.databaseId) {
              updates['<your-database-id>'] = resourceIds.databaseId;
            }
            if (resourceIds.kvId) {
              updates['<your-kv-namespace-id>'] = resourceIds.kvId;
            }

            const configFiles = [
              'wrangler.web.toml',
              'wrangler.github-events.toml',
              'wrangler.indexing.toml',
              'wrangler.classification.toml',
              'wrangler.trending.toml',
            ];

            for (const configFile of configFiles) {
              if (updateWranglerConfig(configFile, updates)) {
                logSuccess(`Updated ${configFile}`);
              }
            }
          }
        } else {
          logInfo('Skipped Cloudflare resource creation');
        }
      }
    }

    // Step 5: 完成
    logStep('5/5', '初始化完成');

    console.log(`
${colors.green}╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   ${colors.bold}初始化完成!${colors.green}                                            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bold}下一步:${colors.reset}

1. 检查并完善 ${colors.cyan}.dev.vars${colors.reset} 中的配置
2. 检查 ${colors.cyan}wrangler.*.toml${colors.reset} 文件中的资源 ID
3. 运行 ${colors.cyan}pnpm install${colors.reset} 安装依赖
4. 运行 ${colors.cyan}pnpm dev${colors.reset} 启动开发服务器

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
