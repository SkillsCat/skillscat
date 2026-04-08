import type { FileNode, SkillDetail } from '$lib/types';

export type DownloadSkillOutcome =
  | 'installed'
  | 'cancelled'
  | 'rate_limited'
  | 'fallback_download';

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  size?: number;
  type?: string;
}

interface DirectSkillFilesPayload {
  folderName: string;
  files: Array<{ path: string; content: string }>;
}

interface DirectGitHubFileResult {
  content: string | null;
  remaining: number | null;
}

interface DownloadSkillOptions {
  skill: SkillDetail;
  encodedApiSkillSlug: string;
  tooManyRequestsMessage: string;
  downloadFailedMessage: string;
}

const MAX_DIRECT_DOWNLOAD_FILES = 12;
const MAX_DIRECT_FILE_SIZE = 512 * 1024;
const MIN_DIRECT_RATE_LIMIT_REMAINING = 15;
const CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY = 'skillscat:github-client-rate-limit-until';
const CLIENT_GITHUB_RATE_LIMIT_FALLBACK_HEADER = 'x-skillscat-client-github-rate-limited';
const DEFAULT_CLIENT_GITHUB_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv', 'webm',
  'exe', 'dll', 'so', 'dylib',
  'woff', 'woff2', 'ttf', 'otf', 'eot'
]);

function fallbackDownload(encodedApiSkillSlug: string): void {
  window.location.href = `/api/skills/${encodedApiSkillSlug}/download`;
}

function isBinaryFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

function decodeGitHubBase64ToUtf8(base64: string): string {
  const cleanBase64 = base64.replace(/\n/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new TextDecoder('utf-8').decode(bytes);
}

function parseRateLimitRemaining(headers: Headers): number | null {
  const value = headers.get('x-ratelimit-remaining');
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRateLimitResetMs(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Date.now() + (seconds * 1000);
    }

    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      return asDate;
    }
  }

  const resetEpoch = headers.get('x-ratelimit-reset');
  if (!resetEpoch) return null;

  const parsed = Number.parseInt(resetEpoch, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed * 1000;
}

function getStoredClientRateLimitUntil(): number | null {
  const raw = window.sessionStorage.getItem(CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY);
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function setStoredClientRateLimitUntil(untilMs: number): void {
  window.sessionStorage.setItem(CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY, String(untilMs));
}

function normalizeClientRateLimitState(): boolean {
  const storedUntil = getStoredClientRateLimitUntil();
  if (!storedUntil) return true;

  if (storedUntil > Date.now()) {
    return false;
  }

  window.sessionStorage.removeItem(CLIENT_GITHUB_RATE_LIMIT_UNTIL_KEY);
  return true;
}

function buildGitHubContentApiUrl(skill: SkillDetail, relativePath: string, allowDirectGitHubRead: boolean): string | null {
  if (
    !allowDirectGitHubRead ||
    skill.visibility !== 'public' ||
    skill.sourceType !== 'github' ||
    !skill.repoOwner ||
    !skill.repoName
  ) {
    return null;
  }

  const normalizedRelativePath = relativePath.replace(/^\/+/, '').replace(/^\.\//, '');
  if (!normalizedRelativePath || normalizedRelativePath.includes('..')) return null;

  const fullPath = skill.skillPath
    ? `${skill.skillPath}/${normalizedRelativePath}`.replace(/^\/+/, '')
    : normalizedRelativePath;

  const encodedPath = fullPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  if (!encodedPath) return null;

  return `https://api.github.com/repos/${encodeURIComponent(skill.repoOwner)}/${encodeURIComponent(skill.repoName)}/contents/${encodedPath}`;
}

async function fetchGitHubFileDirect(
  skill: SkillDetail,
  relativePath: string,
  state: { allowDirectGitHubRead: boolean; pendingClientRateLimitSignal: boolean }
): Promise<DirectGitHubFileResult> {
  const contentUrl = buildGitHubContentApiUrl(skill, relativePath, state.allowDirectGitHubRead);
  if (!contentUrl) return { content: null, remaining: null };

  const response = await fetch(contentUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  const remaining = parseRateLimitRemaining(response.headers);
  if (remaining !== null && remaining <= MIN_DIRECT_RATE_LIMIT_REMAINING) {
    state.allowDirectGitHubRead = false;
  }

  if (response.status === 404) {
    state.allowDirectGitHubRead = false;
    return { content: null, remaining };
  }

  if (
    response.status === 429 ||
    (response.status === 403 && remaining === 0)
  ) {
    state.allowDirectGitHubRead = false;
    state.pendingClientRateLimitSignal = true;

    const resetAt = parseRateLimitResetMs(response.headers) ?? (Date.now() + DEFAULT_CLIENT_GITHUB_RATE_LIMIT_WINDOW_MS);
    setStoredClientRateLimitUntil(resetAt);
    return { content: null, remaining };
  }

  if (!response.ok) {
    throw new Error(`GitHub fetch failed (${response.status})`);
  }

  const payload = await response.json() as GitHubContentResponse;
  if (payload.type !== 'file' || payload.encoding !== 'base64' || !payload.content) {
    throw new Error('Unexpected GitHub content response');
  }

  if (payload.size && payload.size > MAX_DIRECT_FILE_SIZE) {
    throw new Error('File too large');
  }

  return {
    content: decodeGitHubBase64ToUtf8(payload.content),
    remaining,
  };
}

function collectDownloadableFilePaths(nodes: FileNode[], paths: string[]): boolean {
  for (const node of nodes) {
    if (paths.length >= MAX_DIRECT_DOWNLOAD_FILES) return true;

    if (node.type === 'directory') {
      if (node.children && node.children.length > 0) {
        const exceeded = collectDownloadableFilePaths(node.children, paths);
        if (exceeded) return true;
      }
      continue;
    }

    if (isBinaryFile(node.path)) continue;
    if (node.size && node.size > MAX_DIRECT_FILE_SIZE) continue;
    paths.push(node.path);
  }

  return false;
}

async function fetchSkillFilesDirectFromGitHub(
  skill: SkillDetail,
  state: { allowDirectGitHubRead: boolean; pendingClientRateLimitSignal: boolean }
): Promise<DirectSkillFilesPayload | null> {
  if (
    skill.visibility !== 'public' ||
    skill.sourceType !== 'github' ||
    !skill.repoOwner ||
    !skill.repoName ||
    !state.allowDirectGitHubRead
  ) {
    return null;
  }

  try {
    const folderName = skill.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const filePaths: string[] = [];
    let exceededDirectLimit = false;

    if (skill.fileStructure && skill.fileStructure.length > 0) {
      exceededDirectLimit = collectDownloadableFilePaths(skill.fileStructure, filePaths);
    }

    if (filePaths.length === 0) {
      filePaths.push('SKILL.md');
    }

    if (exceededDirectLimit) {
      return null;
    }

    const files: Array<{ path: string; content: string }> = [];
    const uniqueFilePaths = [...new Set(filePaths)];
    let remainingBudget: number | null = null;

    for (const filePath of uniqueFilePaths) {
      if (remainingBudget !== null && remainingBudget <= MIN_DIRECT_RATE_LIMIT_REMAINING) {
        return null;
      }

      const result = await fetchGitHubFileDirect(skill, filePath, state);
      remainingBudget = result.remaining;

      if (result.content === null) {
        return null;
      }

      files.push({ path: filePath, content: result.content });
    }

    if (files.length === 0) return null;
    return { folderName, files };
  } catch (error) {
    console.warn('Direct GitHub fetch failed, fallback to SkillsCat API:', error);
    return null;
  }
}

function consumeClientRateLimitSignalHeaders(state: { pendingClientRateLimitSignal: boolean }): HeadersInit | undefined {
  if (!state.pendingClientRateLimitSignal) return undefined;

  state.pendingClientRateLimitSignal = false;
  return { [CLIENT_GITHUB_RATE_LIMIT_FALLBACK_HEADER]: '1' };
}

async function writeSkillFilesToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  folderName: string,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  const skillDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

  for (const file of files) {
    let targetDir: FileSystemDirectoryHandle = skillDir;
    const pathParts = file.path.split('/');
    const fileName = pathParts.pop();

    if (!fileName) continue;

    for (const part of pathParts) {
      if (part) {
        targetDir = await targetDir.getDirectoryHandle(part, { create: true });
      }
    }

    const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file.content);
    await writable.close();
  }
}

export async function downloadSkill(options: DownloadSkillOptions): Promise<DownloadSkillOutcome> {
  const { skill, encodedApiSkillSlug, tooManyRequestsMessage, downloadFailedMessage } = options;

  if (!('showDirectoryPicker' in window)) {
    fallbackDownload(encodedApiSkillSlug);
    return 'fallback_download';
  }

  const state = {
    allowDirectGitHubRead: normalizeClientRateLimitState(),
    pendingClientRateLimitSignal: false,
  };

  try {
    const dirHandle = await (window as unknown as {
      showDirectoryPicker: (config: { mode: string; startIn: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents'
    });

    let payload = await fetchSkillFilesDirectFromGitHub(skill, state);
    if (!payload) {
      const fallbackHeaders = consumeClientRateLimitSignalHeaders(state);
      const response = await fetch(
        `/api/skills/${encodedApiSkillSlug}/files`,
        fallbackHeaders ? { headers: fallbackHeaders } : undefined
      );

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(tooManyRequestsMessage);
          return 'rate_limited';
        }

        throw new Error(downloadFailedMessage);
      }

      payload = await response.json() as DirectSkillFilesPayload;
    }

    await writeSkillFilesToDirectory(dirHandle, payload.folderName, payload.files);
    return 'installed';
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      return 'cancelled';
    }

    console.error('Download failed:', error);
    fallbackDownload(encodedApiSkillSlug);
    return 'fallback_download';
  }
}
