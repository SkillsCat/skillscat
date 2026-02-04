import pc from 'picocolors';
import { loadSettings, getSetting, setSetting, deleteSetting, getConfigDir, getRegistryUrl, type Settings } from '../utils/config.js';
import { verboseConfig, isVerbose } from '../utils/verbose.js';

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
    console.error(pc.red(`Unknown config key: ${key}`));
    console.log(pc.dim(`Valid keys: ${VALID_KEYS.join(', ')}`));
    process.exit(1);
  }

  setSetting(key as keyof Settings, value);
  console.log(pc.green(`Set ${key} = ${value}`));
}

export async function configGet(key: string, options: ConfigSetOptions = {}): Promise<void> {
  if (isVerbose()) {
    verboseConfig();
  }

  if (!VALID_KEYS.includes(key as keyof Settings)) {
    console.error(pc.red(`Unknown config key: ${key}`));
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

  console.log(pc.bold('Configuration:'));
  console.log();
  console.log(`  ${pc.cyan('Config directory:')} ${getConfigDir()}`);
  console.log();
  console.log(pc.bold('Settings:'));

  // Show registry
  const registry = settings.registry;
  if (registry) {
    console.log(`  ${pc.cyan('registry:')} ${registry}`);
  } else {
    console.log(`  ${pc.cyan('registry:')} ${pc.dim(`(default) ${DEFAULT_REGISTRY_URL}`)}`);
  }

  console.log();
  console.log(pc.dim('Use `skillscat config set <key> <value>` to change settings.'));
}

export async function configDelete(key: string, options: ConfigSetOptions = {}): Promise<void> {
  if (isVerbose()) {
    verboseConfig();
  }

  if (!VALID_KEYS.includes(key as keyof Settings)) {
    console.error(pc.red(`Unknown config key: ${key}`));
    console.log(pc.dim(`Valid keys: ${VALID_KEYS.join(', ')}`));
    process.exit(1);
  }

  deleteSetting(key as keyof Settings);
  console.log(pc.green(`Deleted ${key} (reset to default)`));
}
