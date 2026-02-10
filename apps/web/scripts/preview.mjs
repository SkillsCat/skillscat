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

// 检查是否跳过构建
const skipBuild = process.argv.includes('--skip-build');

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

// Step 2: 启动 wrangler dev
const wranglerArgs = [
  'exec', 'wrangler', 'dev',
  ...configs.flatMap((config) => ['-c', config]),
  '--persist-to', './.wrangler/state',
  '--port', '3000',
];

console.log('Starting preview with configuration:');
configs.forEach((config) => console.log(`  - ${config}`));
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
