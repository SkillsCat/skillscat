import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_REGISTRY_URL = 'https://skills.cat/registry';

export interface Settings {
  registry?: string;
}

/**
 * Get the platform-specific config directory
 * - macOS: ~/Library/Application Support/skillscat/
 * - Linux: ~/.config/skillscat/
 * - Windows: %APPDATA%/skillscat/
 */
export function getConfigDir(): string {
  const os = platform();
  const home = homedir();

  if (os === 'darwin') {
    return join(home, 'Library', 'Application Support', 'skillscat');
  } else if (os === 'win32') {
    return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'skillscat');
  } else {
    // Linux and other Unix-like systems
    return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'skillscat');
  }
}

/**
 * Get the path to auth.json
 */
export function getAuthPath(): string {
  return join(getConfigDir(), 'auth.json');
}

/**
 * Get the path to settings.json
 */
export function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json');
}

/**
 * Get the path to installed.json
 */
export function getInstalledDbPath(): string {
  return join(getConfigDir(), 'installed.json');
}

/**
 * Get the cache directory path
 */
export function getCacheDir(): string {
  return join(getConfigDir(), 'cache');
}

/**
 * Ensure the config directory exists
 */
export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load settings from settings.json
 */
export function loadSettings(): Settings {
  try {
    const settingsPath = getSettingsPath();
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content) as Settings;
    }
  } catch {
    // Ignore errors, return empty settings
  }
  return {};
}

/**
 * Save settings to settings.json
 */
export function saveSettings(settings: Settings): void {
  ensureConfigDir();
  const settingsPath = getSettingsPath();
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Get a specific setting value
 */
export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const settings = loadSettings();
  return settings[key];
}

/**
 * Set a specific setting value
 */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

/**
 * Delete a specific setting
 */
export function deleteSetting<K extends keyof Settings>(key: K): void {
  const settings = loadSettings();
  delete settings[key];
  saveSettings(settings);
}

/**
 * Get the registry URL (from settings or default)
 */
export function getRegistryUrl(): string {
  return getSetting('registry') || DEFAULT_REGISTRY_URL;
}
