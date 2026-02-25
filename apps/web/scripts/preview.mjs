#!/usr/bin/env node

/**
 * Preview Script
 *
 * 启动完整的项目预览，包括 SvelteKit 主站和所有 Workers
 * 1. 先构建 SvelteKit 应用
 * 2. 使用多个 wrangler 配置文件合并启动
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, '..');
const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const cliArgs = process.argv.slice(2);

// 检查是否跳过构建
const skipBuild = cliArgs.includes('--skip-build');
const useProdData = cliArgs.includes('--prod-data');

const passthroughArgs = [];
let hasExplicitEnv = false;
let hasExplicitPort = false;

for (let i = 0; i < cliArgs.length; i++) {
  const arg = cliArgs[i];

  if (arg === '--') {
    continue;
  }

  if (arg === '--skip-build' || arg === '--prod-data') {
    continue;
  }

  if (arg === '-e' || arg === '--env') {
    hasExplicitEnv = true;
    passthroughArgs.push(arg);

    const next = cliArgs[i + 1];
    if (next) {
      passthroughArgs.push(next);
      i += 1;
    }
    continue;
  }

  if (arg.startsWith('--env=')) {
    hasExplicitEnv = true;
  }

  if (arg === '--port') {
    hasExplicitPort = true;
  }

  if (arg.startsWith('--port=')) {
    hasExplicitPort = true;
  }

  passthroughArgs.push(arg);
}

// 配置文件列表
const configs = [
  'wrangler.preview.toml',
  'wrangler.github-events.toml',
  'wrangler.indexing.toml',
  'wrangler.classification.toml',
  'wrangler.trending.toml',
  'wrangler.tier-recalc.toml',
  'wrangler.archive.toml',
  'wrangler.resurrection.toml',
];

// 检查配置文件是否存在
const missingConfigs = configs.filter(
  (config) => !existsSync(resolve(webDir, config))
);

if (missingConfigs.length > 0) {
  console.error('Missing configuration files:');
  missingConfigs.forEach((config) => console.error(`  - ${config}`));
  console.error('\nPlease ensure all wrangler config files exist in apps/web/');
  process.exit(1);
}

// Step 1: 构建 SvelteKit 应用
if (!skipBuild) {
  console.log('Building SvelteKit application...\n');
  const buildResult = spawnSync(pnpmCmd, ['exec', 'vite', 'build'], {
    cwd: webDir,
    stdio: 'inherit',
  });

  if (buildResult.status !== 0) {
    console.error('\nBuild failed!');
    process.exit(buildResult.status || 1);
  }
  console.log('\nBuild completed successfully!\n');
} else {
  console.log('Skipping build (--skip-build flag)\n');
}

const defaultPort = useProdData ? '3001' : '3000';

// Step 2: 启动 wrangler dev
const wranglerArgs = [
  'exec', 'wrangler', 'dev',
  ...configs.flatMap((config) => ['-c', config]),
  '--persist-to', './.wrangler/state',
  ...(hasExplicitPort ? [] : ['--port', defaultPort]),
  ...(useProdData && !hasExplicitEnv ? ['-e', 'production'] : []),
  ...passthroughArgs,
];

console.log('Starting preview with configuration:');
configs.forEach((config) => console.log(`  - ${config}`));
if (useProdData) {
  console.log('Mode: production environment with remote bindings (remote data)');
  console.log('Warning: writes may affect production resources');
}
console.log(`Default port: ${defaultPort}${hasExplicitPort ? ' (overridden by CLI arg)' : ''}`);
console.log(`\nWorking directory: ${webDir}`);
console.log(`Command: ${pnpmCmd} ${wranglerArgs.join(' ')}\n`);

// 启动 wrangler
const wrangler = spawn(pnpmCmd, wranglerArgs, {
  cwd: webDir,
  stdio: 'inherit',
});

wrangler.on('error', (error) => {
  console.error('Failed to start wrangler:', error);
  process.exit(1);
});

wrangler.on('close', (code) => {
  process.exit(code ?? 0);
});

// 处理退出信号
process.on('SIGINT', () => {
  wrangler.kill('SIGINT');
});

process.on('SIGTERM', () => {
  wrangler.kill('SIGTERM');
});
