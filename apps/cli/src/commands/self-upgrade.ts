import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { error, info, success, warn } from '../utils/core/ui';
import { verboseLog } from '../utils/core/verbose';

const PACKAGE_NAME = 'skillscat';

type Manager = 'npm' | 'pnpm' | 'bun';

interface SelfUpgradeOptions {
  manager?: string;
}

interface ManagerInfo {
  manager: Manager;
  globalRoot: string;
  installCommand: string;
  upgradeArgs: string[];
}

function safeExec(command: string, args: string[]): string | null {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim();
  } catch {
    return null;
  }
}

function safeRealpath(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    return targetPath;
  }
}

function getNpmGlobalRoot(): string | null {
  return safeExec('npm', ['root', '-g']);
}

function getPnpmGlobalRoot(): string | null {
  return safeExec('pnpm', ['root', '-g']);
}

function getBunGlobalRoot(): string | null {
  const bunInstall = process.env.BUN_INSTALL || join(os.homedir(), '.bun');
  const root = join(bunInstall, 'install', 'global', 'node_modules');
  return existsSync(root) ? root : null;
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolvePackageRoot(): string | null {
  const scriptPath = process.argv[1]
    ? resolve(process.argv[1])
    : fileURLToPath(import.meta.url);
  let dir = dirname(scriptPath);

  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function getManagerInfos(): ManagerInfo[] {
  const managers: ManagerInfo[] = [];

  const npmRoot = getNpmGlobalRoot();
  if (npmRoot) {
    managers.push({
      manager: 'npm',
      globalRoot: npmRoot,
      installCommand: 'npm install -g skillscat',
      upgradeArgs: ['install', '-g', `${PACKAGE_NAME}@latest`],
    });
  }

  const pnpmRoot = getPnpmGlobalRoot();
  if (pnpmRoot) {
    managers.push({
      manager: 'pnpm',
      globalRoot: pnpmRoot,
      installCommand: 'pnpm add -g skillscat',
      upgradeArgs: ['add', '-g', `${PACKAGE_NAME}@latest`],
    });
  }

  const bunRoot = getBunGlobalRoot();
  if (bunRoot) {
    managers.push({
      manager: 'bun',
      globalRoot: bunRoot,
      installCommand: 'bun add -g skillscat',
      upgradeArgs: ['add', '-g', `${PACKAGE_NAME}@latest`],
    });
  }

  return managers;
}

function isGloballyInstalled(manager: ManagerInfo): boolean {
  return existsSync(join(manager.globalRoot, PACKAGE_NAME, 'package.json'));
}

function formatManagerList(managers: ManagerInfo[]): string {
  return managers.map((m) => m.manager).join(', ');
}

export async function selfUpgrade(options: SelfUpgradeOptions): Promise<void> {
  const managers = getManagerInfos();
  const installedManagers = managers.filter(isGloballyInstalled);

  if (installedManagers.length === 0) {
    warn('Global installation not detected.');
    info('Install skillscat globally first, then run `skillscat self-upgrade`.');
    console.log(pc.dim('  npm install -g skillscat'));
    console.log(pc.dim('  pnpm add -g skillscat'));
    console.log(pc.dim('  bun add -g skillscat'));
    return;
  }

  let selected: ManagerInfo | undefined;

  if (options.manager) {
    const normalized = options.manager.toLowerCase() as Manager;
    if (!['npm', 'pnpm', 'bun'].includes(normalized)) {
      error(`Unknown package manager: ${options.manager}`);
      info('Use one of: npm, pnpm, bun');
      process.exit(1);
    }

    selected = installedManagers.find((m) => m.manager === normalized);
    if (!selected) {
      error(`No global ${normalized} installation found for ${PACKAGE_NAME}.`);
      const managerInfo = managers.find((m) => m.manager === normalized);
      if (managerInfo) {
        info(`Install globally first with: ${managerInfo.installCommand}`);
      }
      process.exit(1);
    }
  } else {
    const packageRoot = resolvePackageRoot();
    const realPackageRoot = packageRoot ? safeRealpath(packageRoot) : null;

    if (realPackageRoot) {
      selected = installedManagers.find((m) =>
        isPathInside(realPackageRoot, safeRealpath(m.globalRoot))
      );
    }

    if (!selected) {
      if (installedManagers.length === 1) {
        selected = installedManagers[0];
      } else {
        const userAgent = process.env.npm_config_user_agent || '';
        if (userAgent.includes('pnpm')) {
          selected = installedManagers.find((m) => m.manager === 'pnpm');
        } else if (userAgent.includes('bun')) {
          selected = installedManagers.find((m) => m.manager === 'bun');
        } else if (userAgent.includes('npm')) {
          selected = installedManagers.find((m) => m.manager === 'npm');
        }

        if (!selected) {
          selected = installedManagers[0];
        }

        warn(`Multiple global installs detected (${formatManagerList(installedManagers)}). Using ${selected.manager}.`);
        info('Run `skillscat self-upgrade --manager <npm|pnpm|bun>` to choose a different manager.');
      }
    }
  }

  if (!selected) {
    error('Unable to determine a package manager for self-upgrade.');
    process.exit(1);
  }

  info(`Updating skillscat via ${selected.manager}...`);
  verboseLog(`Running: ${selected.manager} ${selected.upgradeArgs.join(' ')}`);

  const result = spawnSync(selected.manager, selected.upgradeArgs, { stdio: 'inherit' });

  if (result.error) {
    error(`Failed to run ${selected.manager}.`);
    if (result.error instanceof Error) {
      console.error(pc.dim(result.error.message));
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    error(`${selected.manager} exited with code ${result.status ?? 'unknown'}.`);
    process.exit(result.status ?? 1);
  }

  success('Skillscat CLI updated to the latest version.');
}
