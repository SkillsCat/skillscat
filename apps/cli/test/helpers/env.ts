import { mkdirSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function getTestConfigDir(): string {
  const home = process.env.HOME || homedir();
  const os = platform();

  if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'skillscat');
  }
  if (os === 'win32') {
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'skillscat');
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'skillscat');
}

export function resetTestConfigDir(): void {
  const configDir = getTestConfigDir();
  rmSync(configDir, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });
}

export function resetTestCacheDir(): void {
  const cacheDir = join(getTestConfigDir(), 'cache');
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });
}

export function createWorkspace(label: string): string {
  const base = process.env.SKILLSCAT_TEST_HOME || homedir();
  const workspace = join(base, 'workspaces', `${label}-${Date.now()}`);
  mkdirSync(workspace, { recursive: true });
  process.chdir(workspace);
  return workspace;
}

export async function configureRegistry(url: string): Promise<void> {
  const { setSetting } = await import('../../src/utils/config/config');
  setSetting('registry', url);
}

export async function configureAuth(token: string): Promise<void> {
  const { setTokens } = await import('../../src/utils/auth/auth');
  const now = Date.now();
  setTokens({
    accessToken: token,
    accessTokenExpiresAt: now + 60 * 60 * 1000,
    refreshToken: 'test-refresh-token',
    refreshTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
    user: { id: process.env.SKILLSCAT_TEST_USER_ID || 'user_cli_test' },
  });
}
