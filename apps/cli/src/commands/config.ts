import { error as showError, success as showSuccess, details, hint } from '../utils/core/ui';
import pc from 'picocolors';
import { loadSettings, getSetting, setSetting, deleteSetting, getConfigDir, normalizeRegistryUrl, type Settings } from '../utils/config/config';
import { verboseConfig, isVerbose } from '../utils/core/verbose';

const DEFAULT_REGISTRY_URL = 'https://skills.cat/registry';

const VALID_KEYS: (keyof Settings)[] = ['registry'];

interface ConfigSetOptions {
  parent?: { verbose?: boolean };
}

export async function configSet(key: string, value: string, options: ConfigSetOptions = {}): Promise<void> {
  if (isVerbose()) {
    verboseConfig();
  }

  if (!VALID_KEYS.includes(key as keyof Settings)) {
    showError(`Unknown config key: ${key}`);
    console.log(pc.dim(`Valid keys: ${VALID_KEYS.join(', ')}`));
    process.exit(1);
  }

  if (key === 'registry') {
    const normalized = normalizeRegistryUrl(value);
    if (!normalized) {
      showError('Invalid registry URL. Use HTTPS, or HTTP only for localhost/loopback, with a /registry or /openclaw path.');
      process.exit(1);
    }
    value = normalized;
  }

  setSetting(key as keyof Settings, value);
  showSuccess(`Set ${key} = ${value}`);
}

export async function configGet(key: string, options: ConfigSetOptions = {}): Promise<void> {
  if (isVerbose()) {
    verboseConfig();
  }

  if (!VALID_KEYS.includes(key as keyof Settings)) {
    showError(`Unknown config key: ${key}`);
    console.log(pc.dim(`Valid keys: ${VALID_KEYS.join(', ')}`));
    process.exit(1);
  }

  const value = getSetting(key as keyof Settings);
  if (value !== undefined) {
    console.log(value);
  } else {
    // Show default value
    if (key === 'registry') {
      console.log(pc.dim(`(default) ${DEFAULT_REGISTRY_URL}`));
    } else {
      console.log(pc.dim('(not set)'));
    }
  }
}

export async function configList(options: ConfigSetOptions = {}): Promise<void> {
  if (isVerbose()) {
    verboseConfig();
  }

  const settings = loadSettings();

  details('Configuration:', [['Config directory', getConfigDir()],
    ['registry', settings.registry || `(default) ${DEFAULT_REGISTRY_URL}`]]);
  hint('Change a setting:', 'skillscat config set <key> <value>');
}

export async function configDelete(key: string, options: ConfigSetOptions = {}): Promise<void> {
  if (isVerbose()) {
    verboseConfig();
  }

  if (!VALID_KEYS.includes(key as keyof Settings)) {
    showError(`Unknown config key: ${key}`);
    console.log(pc.dim(`Valid keys: ${VALID_KEYS.join(', ')}`));
    process.exit(1);
  }

  deleteSetting(key as keyof Settings);
  showSuccess(`Deleted ${key} (reset to default)`);
}
