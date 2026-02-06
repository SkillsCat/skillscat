import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../..');
const WEB_DIR = resolve(ROOT_DIR, 'apps/web');
const WORKER_PATH = resolve(WEB_DIR, '.svelte-kit/cloudflare/_worker.js');

const DEFAULT_TOKEN = 'sk_test_cli_token_00000000000000000000000000000000';
const DEFAULT_USER_ID = 'user_cli_test';
const DEFAULT_USER_NAME = 'testuser';
const DEFAULT_USER_EMAIL = 'test@skillscat.local';
const DEFAULT_REGISTRY_URL = 'http://localhost:3000/registry';

async function waitForServer(url: string, timeoutMs = 90000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  const fetchFn = (globalThis as any).fetch as (input: string) => Promise<{ ok: boolean }>;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetchFn(`${url}/search?limit=1`);
      if (response.ok) {
        return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Preview server did not become ready in time. Last error: ${String(lastError)}`);
}

function runCommand(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  process.env.SKILLSCAT_TEST_TOKEN = process.env.SKILLSCAT_TEST_TOKEN || DEFAULT_TOKEN;
  process.env.SKILLSCAT_TEST_USER_ID = process.env.SKILLSCAT_TEST_USER_ID || DEFAULT_USER_ID;
  process.env.SKILLSCAT_TEST_USER_NAME = process.env.SKILLSCAT_TEST_USER_NAME || DEFAULT_USER_NAME;
  process.env.SKILLSCAT_TEST_USER_EMAIL = process.env.SKILLSCAT_TEST_USER_EMAIL || DEFAULT_USER_EMAIL;
  process.env.SKILLSCAT_TEST_REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || DEFAULT_REGISTRY_URL;

  // Ensure web build exists for preview
  if (!existsSync(WORKER_PATH)) {
    runCommand('pnpm', ['--filter', '@skillscat/web', 'build'], ROOT_DIR);
  }

  // Apply local migrations
  runCommand('pnpm', ['--filter', '@skillscat/web', 'db:migrate'], ROOT_DIR);

  // Seed local test account + token
  runCommand('node', ['scripts/seed-test-account.mjs'], ROOT_DIR);

  // Start preview server
  const preview = spawn('pnpm', ['preview:web', '--', '--skip-build'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  preview.on('error', (error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start preview:web', error);
  });

  try {
    await waitForServer(process.env.SKILLSCAT_TEST_REGISTRY_URL!);
  } catch (error) {
    preview.kill('SIGINT');
    throw error;
  }

  return async () => {
    preview.kill('SIGINT');
    await new Promise<void>((resolve) => {
      preview.on('close', () => resolve());
      setTimeout(() => resolve(), 5000);
    });
  };
}
