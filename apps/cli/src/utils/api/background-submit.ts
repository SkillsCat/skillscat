import { getBaseUrl } from '../auth/auth';
import type { RepoSource } from '../source/source';

const CLI_USER_AGENT = 'skillscat-cli/0.1.0';
const BACKGROUND_SUBMIT_ENV = 'SKILLSCAT_BACKGROUND_SUBMIT';
const BACKGROUND_SUBMIT_DISABLE_ENV = 'SKILLSCAT_DISABLE_BACKGROUND_SUBMIT';

function normalizeSkillPath(path?: string): string | undefined {
  if (!path) return undefined;
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return undefined;
  const pathWithoutSkillFile = normalized.replace(/(?:^|\/)SKILL\.md$/i, '');
  return pathWithoutSkillFile || undefined;
}

function buildGitHubRepoUrl(source: RepoSource): string {
  const base = `https://github.com/${source.owner}/${source.repo}`;
  const path = source.path?.replace(/^\/+/, '');
  if (!path) return base;
  return `${base}/${path}`;
}

function envFlagFalse(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no';
}

function envFlagTrue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

export function isBackgroundSubmitEnabled(): boolean {
  if (envFlagTrue(process.env[BACKGROUND_SUBMIT_DISABLE_ENV])) {
    return false;
  }

  if (process.env[BACKGROUND_SUBMIT_ENV] !== undefined) {
    return !envFlagFalse(process.env[BACKGROUND_SUBMIT_ENV]);
  }

  return true;
}

/**
 * Best-effort, fire-and-forget anonymous repo submission for indexing.
 * Intentionally does not await the response and fails silently.
 */
export function submitRepoForIndexingInBackground(source: RepoSource): void {
  if (source.platform !== 'github') return;
  if (!isBackgroundSubmitEnabled()) return;

  try {
    const baseUrl = getBaseUrl();
    const payload: { url: string; skillPath?: string } = {
      url: buildGitHubRepoUrl(source),
    };

    const normalizedSkillPath = normalizeSkillPath(source.path);
    if (normalizedSkillPath) {
      payload.skillPath = normalizedSkillPath;
    }

    void fetch(`${baseUrl}/api/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': CLI_USER_AGENT,
        'X-Skillscat-Background-Submit': '1',
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // Intentionally fail silent.
  }
}
