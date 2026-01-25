#!/usr/bin/env node

/**
 * Preview Script
 *
 * 启动完整的项目预览，包括 SvelteKit 主站和所有 Workers
 * 使用多个 wrangler 配置文件合并启动
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, '..');

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

// 构建 wrangler 命令参数
const wranglerArgs = [
  'wrangler', 'dev',
  ...configs.flatMap((config) => ['-c', config]),
  '--persist-to', './.wrangler/state',
  '--port', '3000',
];

console.log('Starting preview with configuration:');
configs.forEach((config) => console.log(`  - ${config}`));
console.log(`\nWorking directory: ${webDir}`);
console.log(`Command: npx ${wranglerArgs.join(' ')}\n`);

// 启动 wrangler
const wrangler = spawn('npx', wranglerArgs, {
  cwd: webDir,
  stdio: 'inherit',
  shell: true,
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
