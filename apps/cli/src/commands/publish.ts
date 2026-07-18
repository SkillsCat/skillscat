import pc from 'picocolors';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { getBaseUrl, getValidToken } from '../utils/auth/auth';
import { fetchWithTimeout } from '../utils/core/fetch';
import { box, prompt, warn } from '../utils/core/ui';

interface PublishOptions {
  name?: string;
  org?: string;
  private?: boolean;  // Force private visibility
  description?: string;
  yes?: boolean;  // Skip confirmation
}

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

function collectPublishFiles(resolvedPath: string, skillMdPath: string): PublishFile[] {
  if (resolvedPath === skillMdPath) {
    return [{ path: 'SKILL.md', content: readFileSync(skillMdPath, 'utf-8') }];
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

      const path = relative(resolvedPath, absolutePath).replace(/\\/g, '/');
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
  return files.sort((left, right) => left.path.localeCompare(right.path));
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

  return response.json() as Promise<PreviewResponse>;
}

export async function publish(skillPath: string, options: PublishOptions): Promise<void> {
  // Check authentication/session validity
  const token = await getValidToken();
  if (!token) {
    console.error(pc.red('Authentication required or session expired.'));
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    process.exit(1);
  }

  // Resolve skill path
  const resolvedPath = resolve(skillPath);
  let skillMdPath = resolvedPath;

  // If path is a directory, look for SKILL.md
  if (existsSync(resolvedPath) && !resolvedPath.endsWith('.md')) {
    skillMdPath = resolve(resolvedPath, 'SKILL.md');
  }

  if (!existsSync(skillMdPath)) {
    console.error(pc.red(`SKILL.md not found at ${skillMdPath}`));
    process.exit(1);
  }

  let publishFiles: PublishFile[];
  try {
    publishFiles = collectPublishFiles(resolvedPath, skillMdPath);
  } catch (fileError) {
    console.error(pc.red(fileError instanceof Error ? fileError.message : 'Failed to read skill files.'));
    process.exit(1);
  }
  const skillMd = publishFiles.find((file) => file.path === 'SKILL.md')!;
  const content = skillMd.content;

  // Get preview first
  console.log(pc.cyan('Analyzing skill...'));
  console.log();

  try {
    const previewResult = await getPreview(publishFiles, token, options.org, options.name);

    if (!previewResult.success || !previewResult.preview) {
      console.error(pc.red(`Failed to analyze skill: ${previewResult.error || previewResult.message || 'Unknown error'}`));
      process.exit(1);
    }

    const { preview, warnings, suggestedVisibility, canPublishPrivate } = previewResult;

    if (canPublishPrivate === false) {
      console.error(pc.red('Cannot publish: identical content already exists as a public skill.'));
      console.log(pc.dim('Update the skill content or install the existing public skill instead.'));
      process.exit(1);
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
    const previewContent = [
      `Name: ${pc.cyan(preview.name)}`,
      `Slug: ${pc.cyan(preview.slug)}`,
      `Description: ${preview.description ? pc.dim(preview.description.slice(0, 60) + (preview.description.length > 60 ? '...' : '')) : pc.dim('(none)')}`,
      `Categories: ${preview.categories.length > 0 ? pc.cyan(preview.categories.join(', ')) : pc.dim('(auto-classified)')}`,
      `Visibility: ${pc.dim(visibility)}`,
    ].join('\n');

    box(previewContent, 'Skill Preview');
    console.log();

    // Show warnings
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        warn(w);
      }
      console.log();
    }

    // Show immutable slug warning
    console.log(pc.yellow('⚠️  Warning: The slug cannot be changed after publishing.'));
    console.log();

    // Confirm unless --yes flag is provided
    if (!options.yes) {
      const answer = await prompt(`Publish ${pc.cyan(preview.slug)}? [y/N] `);
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(pc.dim('Cancelled.'));
        process.exit(0);
      }
      console.log();
    }

    // Proceed with upload
    console.log(pc.cyan('Publishing skill...'));

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
      console.error(pc.red('Session expired. Please run `skillscat login` and try again.'));
      process.exit(1);
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
      console.error(pc.red(`Failed to publish: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    console.log(pc.green('✔ Skill published successfully!'));
    console.log();
    console.log(`  Slug: ${pc.cyan(result.slug)}`);
    console.log(`  Visibility: ${pc.dim(visibility)}`);
    if (result.categories && result.categories.length > 0) {
      console.log(`  Categories: ${pc.dim(result.categories.join(', '))}`);
    }
    console.log();
    console.log(pc.dim('To install this skill:'));
    console.log(pc.cyan(`  npx skillscat add ${result.slug}`));
  } catch (error) {
    console.error(pc.red('Failed to connect to registry.'));
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    process.exit(1);
  }
}
