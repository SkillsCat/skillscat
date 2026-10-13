import { error as showError, info as showInfo, success as showSuccess, warn as showWarning, cancelled, details, hint, warn, PromptCancelledError } from '../utils/core/ui';
import pc from 'picocolors';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { getBaseUrl, getValidToken } from '../utils/auth/auth';
import { fetchWithTimeout } from '../utils/core/fetch';
import { confirm } from '../utils/core/prompts';
import type { SkillInfo } from '../utils/source/source';
import { normalizeCompanionRelativePath } from '../utils/storage/skill-files';

interface PublishOptions {
  name?: string;
  org?: string;
  private?: boolean;  // Force private visibility
  description?: string;
  yes?: boolean;  // Skip confirmation
  throwOnError?: boolean; // Let an enclosing batch continue after a failed publication
  bundle?: SkillInfo; // Already installed snapshot supplied by the local install guide
}

class PublishError extends Error {}

interface PreviewResponse {
  success: boolean;
  preview?: {
    name: string;
    slug: string;
    description: string | null;
    categories: string[];
    owner: string;
  };
  suggestedVisibility?: 'public' | 'private';
  canPublishPrivate?: boolean;
  warnings?: string[];
  error?: string;
  message?: string;
}

interface UploadResponse {
  success: boolean;
  slug?: string;
  name?: string;
  description?: string | null;
  categories?: string[];
  message?: string;
  error?: string;
}

interface PublishFile {
  path: string;
  content: string;
}

const MAX_PUBLISH_FILES = 50;
const MAX_PUBLISH_FILE_BYTES = 512 * 1024;
const MAX_PUBLISH_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_PUBLISH_PATH_LENGTH = 512;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
const SKIPPED_FILES = new Set(['.DS_Store', '.skillscat-companion-files.json']);

function validatePublishFiles(files: PublishFile[]): PublishFile[] {
  if (files.length > MAX_PUBLISH_FILES) throw new Error(`A maximum of ${MAX_PUBLISH_FILES} files can be published at once.`);
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!file.path || file.path.trim() !== file.path || file.path.length > MAX_PUBLISH_PATH_LENGTH
      || normalizeCompanionRelativePath(file.path) !== file.path || /[\x00-\x1F\x7F]/.test(file.path)
      || paths.has(file.path.toLowerCase())) throw new Error(`Invalid or duplicate companion file path: ${file.path}`);
    paths.add(file.path.toLowerCase());
    const size = Buffer.byteLength(file.content);
    if (size > MAX_PUBLISH_FILE_BYTES) throw new Error(`File exceeds the ${MAX_PUBLISH_FILE_BYTES} byte limit: ${file.path}`);
    totalBytes += size;
    if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) throw new Error(`Published files exceed the ${MAX_PUBLISH_TOTAL_BYTES} byte total limit.`);
    if (/[\x00-\x08\x0E-\x1F]/.test(file.content)) throw new Error(`Companion file contains unsupported control characters: ${file.path}`);
  }
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('SKILL.md was not found in the publish bundle.');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function collectSnapshotFiles(skill: SkillInfo): PublishFile[] {
  if ((skill.companionFiles?.length ?? 0) + 1 > MAX_PUBLISH_FILES) throw new Error(`A maximum of ${MAX_PUBLISH_FILES} files can be published at once.`);
  const mainFile = validatePublishFiles([{ path: 'SKILL.md', content: skill.content }])[0];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return validatePublishFiles([
    mainFile,
    ...(skill.companionFiles ?? []).map((file) => {
      if (file.content.byteLength > MAX_PUBLISH_FILE_BYTES) throw new Error(`File exceeds the ${MAX_PUBLISH_FILE_BYTES} byte limit: ${file.path}`);
      let content: string;
      try { content = decoder.decode(file.content); }
      catch { throw new Error(`Only UTF-8 text companion files are supported: ${file.path}`); }
      return { path: file.path, content };
    }),
  ]);
}

function collectPublishFiles(resolvedPath: string, skillMdPath: string): PublishFile[] {
  if (resolvedPath === skillMdPath) {
    const stat = lstatSync(skillMdPath);
    if (!stat.isFile()) throw new Error('The publish source must be a regular SKILL.md file or a skill directory.');
    if (stat.size > MAX_PUBLISH_FILE_BYTES) throw new Error(`File exceeds the ${MAX_PUBLISH_FILE_BYTES} byte limit: SKILL.md`);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(skillMdPath));
    return validatePublishFiles([{ path: 'SKILL.md', content }]);
  }

  const files: PublishFile[] = [];
  let totalBytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });

  const walk = (directory: string, isRoot: boolean): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    // Nested skills are independent bundles, not companion files of the root skill.
    if (!isRoot && entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md')) {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      if (entry.isFile() && SKIPPED_FILES.has(entry.name)) {
        continue;
      }

      const absolutePath = resolve(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(absolutePath, false);
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }

      const path = relative(resolvedPath, absolutePath).split(sep).join('/');
      if (!path || path.length > MAX_PUBLISH_PATH_LENGTH) {
        throw new Error(`Invalid or overly long companion file path: ${path || entry.name}`);
      }
      if (files.length >= MAX_PUBLISH_FILES) {
        throw new Error(`A maximum of ${MAX_PUBLISH_FILES} files can be published at once.`);
      }
      if (stat.size > MAX_PUBLISH_FILE_BYTES) {
        throw new Error(`File exceeds the ${MAX_PUBLISH_FILE_BYTES} byte limit: ${path}`);
      }
      totalBytes += stat.size;
      if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
        throw new Error(`Published files exceed the ${MAX_PUBLISH_TOTAL_BYTES} byte total limit.`);
      }

      const bytes = readFileSync(absolutePath);
      let content: string;
      try {
        content = decoder.decode(bytes);
      } catch {
        throw new Error(`Only UTF-8 text companion files are supported: ${path}`);
      }
      if (/[\x00-\x08\x0E-\x1F]/.test(content)) {
        throw new Error(`Companion file contains unsupported control characters: ${path}`);
      }
      files.push({
        path: path.toLowerCase() === 'skill.md' ? 'SKILL.md' : path,
        content,
      });
    }
  };

  walk(resolvedPath, true);
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('SKILL.md was not found in the publish bundle.');
  }
  return validatePublishFiles(files);
}

/**
 * Get preview of skill metadata before publishing
 */
async function getPreview(files: PublishFile[], token: string, org?: string, name?: string): Promise<PreviewResponse> {
  const skillMd = files.find((file) => file.path === 'SKILL.md');
  if (!skillMd) {
    throw new Error('SKILL.md was not found in the publish bundle.');
  }
  const baseUrl = getBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/api/skills/upload/preview`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'skillscat-cli/0.1.0',
        'Origin': baseUrl,
      },
      body: JSON.stringify({
        content: skillMd.content,
        files: files
          .filter((file) => file.path !== 'SKILL.md')
          .map((file) => ({ path: file.path, content: file.content })),
        org: org?.trim().toLowerCase() || undefined,
        name: name || undefined,
      }),
    }
  );

  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as PreviewResponse;
    return { success: false, error: failure.error || failure.message || `Preview request failed (HTTP ${response.status}).` };
  }
  return response.json() as Promise<PreviewResponse>;
}

export async function publish(skillPath: string, options: PublishOptions): Promise<void> {
  function fail(): never {
    if (options.throwOnError) throw new PublishError('Publishing failed; installation remains available locally.');
    process.exit(1);
  }
  // Check authentication/session validity
  const token = await getValidToken();
  if (!token) {
    showError('Authentication required or session expired.');
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    fail();
  }

  // Resolve skill path
  const resolvedPath = resolve(skillPath);
  let skillMdPath = resolvedPath;

  // If path is a directory, look for SKILL.md
  if (!options.bundle && lstatSync(resolvedPath, { throwIfNoEntry: false })?.isDirectory()) {
    skillMdPath = resolve(resolvedPath, 'SKILL.md');
  }

  if (!options.bundle && !existsSync(skillMdPath)) {
    showError(`SKILL.md not found at ${skillMdPath}`);
    fail();
  }

  let publishFiles: PublishFile[];
  try {
    publishFiles = options.bundle ? collectSnapshotFiles(options.bundle) : collectPublishFiles(resolvedPath, skillMdPath);
  } catch (fileError) {
    showError(fileError instanceof Error ? fileError.message : 'Failed to read skill files.');
    fail();
  }
  const skillMd = publishFiles.find((file) => file.path === 'SKILL.md')!;
  const content = skillMd.content;

  // Get preview first
  showInfo('Analyzing skill...');
  console.log();

  try {
    const previewResult = await getPreview(publishFiles, token, options.org, options.name);

    if (!previewResult.success || !previewResult.preview) {
      showError(`Failed to analyze skill: ${previewResult.error || previewResult.message || 'Unknown error'}`);
      fail();
    }

    const { preview, warnings, suggestedVisibility, canPublishPrivate } = previewResult;

    if (canPublishPrivate === false) {
      showError('Cannot publish: identical content already exists as a public skill.');
      console.log(pc.dim('Update the skill content or install the existing public skill instead.'));
      fail();
    }

    // Determine final visibility
    // - If --private flag is set, use private (if allowed)
    // - Otherwise use suggested visibility from API
    let visibility: 'public' | 'private';

    if (options.private) {
      visibility = 'private';
    } else {
      // Use suggested visibility (public if org connected to GitHub, private otherwise)
      visibility = suggestedVisibility || 'private';
    }

    // Show preview box
    details('Skill Preview', [
      ['Name', preview.name], ['Slug', preview.slug], ['Description', preview.description || '(none)'],
      ['Categories', preview.categories.length ? preview.categories.join(', ') : '(auto-classified)'],
      ['Visibility', visibility],
    ]);
    console.log();

    // Show warnings
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        warn(w);
      }
      console.log();
    }

    // Show immutable slug warning
    showWarning('The slug cannot be changed after publishing.');
    console.log();

    // Confirm unless --yes flag is provided
    if (!options.yes) {
      if (!await confirm(`Publish ${preview.slug}?`)) {
        cancelled();
        return;
      }
      console.log();
    }

    // Proceed with upload
    showInfo('Publishing skill...');

    // Prepare form data
    const formData = new FormData();
    formData.append('skill_md', new Blob([content], { type: 'text/markdown' }), 'SKILL.md');
    for (const file of publishFiles) {
      if (file.path === 'SKILL.md') continue;
      formData.append('files', new Blob([file.content], { type: 'text/plain' }), file.path);
    }
    formData.append('name', options.name || preview.name);
    formData.append('visibility', visibility);

    if (options.org) {
      formData.append('org', options.org.trim().toLowerCase());
    }

    if (options.description) {
      formData.append('description', options.description);
    }

    const uploadToken = await getValidToken();
    if (!uploadToken) {
      showError('Session expired. Please run `skillscat login` and try again.');
      fail();
    }
    const baseUrl = getBaseUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/skills/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${uploadToken}`,
        'User-Agent': 'skillscat-cli/0.1.0',
        'Origin': baseUrl,
      },
      body: formData,
    });

    const result = await response.json() as UploadResponse;

    if (!response.ok || !result.success) {
      showError(`Failed to publish: ${result.error || result.message || 'Unknown error'}`);
      fail();
    }

    showSuccess('Skill published successfully!');
    const fields: Array<[string, string]> = [['Slug', result.slug || preview.slug], ['Visibility', visibility]];
    if (result.categories?.length) fields.push(['Categories', result.categories.join(', ')]);
    details('Published skill', fields);
    hint('To install this skill:', `npx skillscat add ${result.slug || preview.slug}`);
  } catch (error) {
    if (error instanceof PublishError || error instanceof PromptCancelledError) throw error;
    showError('Failed to connect to registry.');
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    fail();
  }
}
