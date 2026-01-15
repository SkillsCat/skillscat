#!/usr/bin/env node

/**
 * SkillsCat Multi-Worker Development Script
 *
 * 启动多个 Cloudflare Workers 进行本地开发
 *
 * Usage:
 *   node scripts/dev-workers.mjs [options]
 *
 * Options:
 *   --all           启动所有 workers
 *   --web           启动 web worker
 *   --github-events 启动 github-events worker
 *   --indexing      启动 indexing worker
 *   --classification 启动 classification worker
 *   --trending      启动 trending worker
 *   --port <port>   Web worker 端口 (默认: 3000)
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

// Worker 配置
const WORKERS = {
  web: {
    config: 'wrangler.web.toml',
    port: 3000,
    description: 'SvelteKit 主站',
  },
  'github-events': {
    config: 'wrangler.github-events.toml',
    port: 3001,
    description: 'GitHub Events 轮询',
  },
  indexing: {
    config: 'wrangler.indexing.toml',
    port: 3002,
    description: '入库处理',
  },
  classification: {
    config: 'wrangler.classification.toml',
    port: 3003,
    description: 'AI 分类',
  },
  trending: {
    config: 'wrangler.trending.toml',
    port: 3004,
    description: 'Trending 计算',
  },
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const workerColors = {
  web: colors.green,
  'github-events': colors.blue,
  indexing: colors.magenta,
  classification: colors.cyan,
  trending: colors.yellow,
};

function log(worker, message, color = colors.reset) {
  const prefix = `[${worker}]`.padEnd(18);
  console.log(`${color}${prefix}${colors.reset} ${message}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    workers: [],
    port: 3000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--all') {
      options.workers = Object.keys(WORKERS);
    } else if (arg === '--port' && args[i + 1]) {
      options.port = parseInt(args[++i], 10);
    } else if (arg.startsWith('--')) {
      const worker = arg.slice(2);
      if (WORKERS[worker]) {
        options.workers.push(worker);
      }
    }
  }

  // 默认启动 web
  if (options.workers.length === 0) {
    options.workers = ['web'];
  }

  return options;
}

function checkConfigs(workers) {
  const missing = [];

  for (const worker of workers) {
    const configPath = resolve(ROOT_DIR, WORKERS[worker].config);
    if (!existsSync(configPath)) {
      missing.push({
        worker,
        config: WORKERS[worker].config,
        example: `${WORKERS[worker].config}.example`,
      });
    }
  }

  if (missing.length > 0) {
    console.error(`${colors.red}缺少配置文件:${colors.reset}\n`);
    for (const { worker, config, example } of missing) {
      console.error(`  ${worker}: 请复制 ${example} 为 ${config} 并填入配置`);
    }
    console.error('');
    process.exit(1);
  }
}

function startWorker(worker, basePort) {
  const config = WORKERS[worker];
  const port = worker === 'web' ? basePort : config.port;
  const color = workerColors[worker];

  log(worker, `启动中... (端口: ${port})`, color);

  const wranglerArgs = [
    'wrangler', 'dev',
    '-c', config.config,
    '--persist-to', './.wrangler/state',
    '--port', String(port),
  ];

  // Web worker 需要特殊处理
  if (worker === 'web') {
    wranglerArgs.push('--local');
  }

  const proc = spawn('npx', wranglerArgs, {
    cwd: ROOT_DIR,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FORCE_COLOR: '1',
    },
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      log(worker, line, color);
    }
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      log(worker, line, colors.red);
    }
  });

  proc.on('error', (err) => {
    log(worker, `启动失败: ${err.message}`, colors.red);
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(worker, `退出 (code: ${code})`, colors.red);
    }
  });

  return proc;
}

async function main() {
  const options = parseArgs();

  console.log(`\n${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}     SkillsCat Development Server       ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════╝${colors.reset}\n`);

  console.log('启动 Workers:');
  for (const worker of options.workers) {
    const config = WORKERS[worker];
    console.log(`  • ${worker}: ${config.description}`);
  }
  console.log('');

  // 检查配置文件
  checkConfigs(options.workers);

  // 启动所有 workers
  const processes = [];
  for (const worker of options.workers) {
    processes.push(startWorker(worker, options.port));
  }

  // 处理退出信号
  const cleanup = () => {
    console.log(`\n${colors.yellow}正在关闭所有 workers...${colors.reset}`);
    for (const proc of processes) {
      proc.kill('SIGTERM');
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(console.error);
