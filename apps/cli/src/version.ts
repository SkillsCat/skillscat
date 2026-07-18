import { readFileSync } from 'node:fs';

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    ) as { version?: unknown };
    if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
      return packageJson.version;
    }
  } catch {
    // A packaged CLI should always include package.json; keep startup resilient if it is damaged.
  }
  return '0.0.0';
}

export const CLI_VERSION = readPackageVersion();
