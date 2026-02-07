import { getRegistryUrl as getConfigRegistryUrl, getConfigDir as getNewConfigDir, getInstalledDbPath as getNewInstalledDbPath } from './config';

/**
 * Get the resolved registry URL (from settings or default)
 */
export function getResolvedRegistryUrl(): string {
  return getConfigRegistryUrl();
}

/**
 * @deprecated Use getConfigDir() from config.ts instead
 */
export function getConfigDir(): string {
  return getNewConfigDir();
}

/**
 * @deprecated Use getInstalledDbPath() from config.ts instead
 */
export function getInstalledSkillsDb(): string {
  return getNewInstalledDbPath();
}
