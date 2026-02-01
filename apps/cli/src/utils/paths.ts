import { homedir } from 'node:os';
import { join } from 'node:path';

export const REGISTRY_URL = 'https://skillscat.com/api/registry';

export function getConfigDir(): string {
  return join(homedir(), '.skillscat');
}

export function getInstalledSkillsDb(): string {
  return join(getConfigDir(), 'installed.json');
}
