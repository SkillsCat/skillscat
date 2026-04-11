import * as browser from '../utils/core/browser';
import { getRegistryUrl } from '../utils/config/config';
import { getValidToken } from '../utils/auth/auth';
import { parseHttpError, parseNetworkError } from '../utils/core/errors';
import { buildSkillPath, parseSlug } from '../utils/core/slug';
import { error, info, warn } from '../utils/core/ui';
import { verboseRequest, verboseResponse } from '../utils/core/verbose';

interface ViewOptions {
  output?: string;
}

type ViewOutput = 'html' | 'markdown';

class ViewHttpError extends Error {}

function normalizeOutputFormat(output?: string): ViewOutput | null {
  if (!output) {
    return null;
  }

  const normalized = output.trim().toLowerCase();
  if (normalized === 'html' || normalized === 'markdown') {
    return normalized;
  }

  return null;
}

function getSiteBaseUrl(): string {
  const registryUrl = getRegistryUrl();

  try {
    const parsed = new URL(registryUrl);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const strippedPathname = pathname.endsWith('/registry')
      ? pathname.slice(0, -'/registry'.length)
      : pathname.endsWith('/openclaw')
        ? pathname.slice(0, -'/openclaw'.length)
        : pathname;

    return `${parsed.protocol}//${parsed.host}${strippedPathname}`;
  } catch {
    return registryUrl.replace(/\/(?:registry|openclaw)\/?$/, '');
  }
}

function buildSkillUrl(slug: string): string {
  return `${getSiteBaseUrl()}${buildSkillPath(slug)}`;
}

async function buildViewHeaders(output: ViewOutput): Promise<Record<string, string>> {
  const token = await getValidToken();
  const headers: Record<string, string> = {
    'User-Agent': output === 'markdown'
      ? 'skillscat-cli/0.1.0 OpenClaw/1.0'
      : 'skillscat-cli/0.1.0',
    Accept: output === 'markdown'
      ? 'text/markdown, text/plain;q=0.9, */*;q=0.8'
      : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchSkillDocument(slug: string, output: ViewOutput): Promise<string> {
  const url = buildSkillUrl(slug);
  const headers = await buildViewHeaders(output);
  const startTime = Date.now();

  verboseRequest('GET', url, headers);

  try {
    const response = await fetch(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      const httpError = parseHttpError(response.status, response.statusText);
      throw new ViewHttpError(httpError.message);
    }

    return response.text();
  } catch (err) {
    if (!(err instanceof ViewHttpError)) {
      const networkError = parseNetworkError(err);
      throw new Error(networkError.message);
    }

    throw err;
  }
}

function writeOutput(body: string): void {
  console.log(body);
}

export async function view(slug: string, options: ViewOptions = {}): Promise<void> {
  try {
    parseSlug(slug);
  } catch {
    error('Invalid slug. Expected format: owner/name');
    process.exit(1);
  }

  if (options.output) {
    const output = normalizeOutputFormat(options.output);
    if (!output) {
      error('Invalid output format. Use `html` or `markdown`.');
      process.exit(1);
    }

    try {
      const body = await fetchSkillDocument(slug, output);
      writeOutput(body);
      return;
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to fetch skill view');
      process.exit(1);
    }
  }

  const url = buildSkillUrl(slug);

  if (browser.canOpenUrlInBrowser()) {
    const opened = await browser.openUrlInBrowser(url);
    if (opened) {
      info(`Opened ${slug} in your browser.`);
      return;
    }

    warn('Unable to open a browser automatically. Printing markdown instead.');
  } else {
    warn('No browser environment detected. Printing markdown instead.');
  }

  try {
    const markdown = await fetchSkillDocument(slug, 'markdown');
    writeOutput(markdown);
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to fetch skill view');
    process.exit(1);
  }
}
