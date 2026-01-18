import { homedir } from 'os';
import { join } from 'path';

export const REGISTRY_URL = 'https://skillscat.com/api/registry';

export function getConfigDir(): string {
  return join(homedir(), '.skillscat');
}

export function getInstalledSkillsDb(): string {
  return join(getConfigDir(), 'installed.json');
}
