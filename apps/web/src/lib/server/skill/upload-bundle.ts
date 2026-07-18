import { error } from '@sveltejs/kit';
import type { FileNode } from '$lib/types';
import {
  computeBundleManifestHash,
  computeExactBundleFingerprint,
  computeSha256Hex,
  computeSkillMdHashes,
  type StoredSkillHashes,
} from '$lib/server/skill/dedup';

export const MAX_UPLOAD_BUNDLE_FILES = 50;
export const MAX_UPLOAD_BUNDLE_FILE_BYTES = 512 * 1024;
export const MAX_UPLOAD_BUNDLE_TOTAL_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_BUNDLE_PATH_LENGTH = 512;

export interface UploadBundleFile {
  path: string;
  content: string;
  size: number;
}

export interface UploadBundleMetadata {
  hashes: StoredSkillHashes;
  manifestFiles: Array<{
    path: string;
    sha: string;
    size: number;
    type: 'text';
  }>;
}

function normalizeUploadPath(value: string): string {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
  return normalized.toLowerCase() === 'skill.md' ? 'SKILL.md' : normalized;
}

function validateUploadPath(value: string): string {
  const path = normalizeUploadPath(value);
  if (
    !path
    || path.length > MAX_UPLOAD_BUNDLE_PATH_LENGTH
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw error(400, `Invalid file path: ${value || '(empty)'}`);
  }
  return path;
}

function validateBundle(files: UploadBundleFile[]): UploadBundleFile[] {
  if (files.length > MAX_UPLOAD_BUNDLE_FILES) {
    throw error(413, `A maximum of ${MAX_UPLOAD_BUNDLE_FILES} files can be published at once`);
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (seen.has(file.path)) {
      throw error(400, `Duplicate file path: ${file.path}`);
    }
    seen.add(file.path);
    if (file.size > MAX_UPLOAD_BUNDLE_FILE_BYTES) {
      throw error(413, `File exceeds the ${MAX_UPLOAD_BUNDLE_FILE_BYTES} byte limit: ${file.path}`);
    }
    if (/[\x00-\x08\x0E-\x1F]/.test(file.content)) {
      throw error(400, `File contains unsupported control characters: ${file.path}`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_UPLOAD_BUNDLE_TOTAL_BYTES) {
      throw error(413, `Published files exceed the ${MAX_UPLOAD_BUNDLE_TOTAL_BYTES} byte total limit`);
    }
  }

  if (!seen.has('SKILL.md')) {
    throw error(400, 'SKILL.md is required');
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function createSkillMdFile(skillMdContent: string): UploadBundleFile {
  return {
    path: 'SKILL.md',
    content: skillMdContent,
    size: new TextEncoder().encode(skillMdContent).byteLength,
  };
}

export async function collectMultipartUploadBundle(
  formData: FormData,
  skillMdContent: string
): Promise<UploadBundleFile[]> {
  const uploads = [...formData.getAll('files'), ...formData.getAll('files[]')];
  const files = [createSkillMdFile(skillMdContent)];

  for (const entry of uploads) {
    if (!(entry instanceof File)) {
      throw error(400, 'files must be uploaded as file fields');
    }
    const path = validateUploadPath(entry.name);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await entry.arrayBuffer());
    } catch {
      throw error(400, `File must contain valid UTF-8 text: ${path}`);
    }
    files.push({
      path,
      content,
      size: new TextEncoder().encode(content).byteLength,
    });
  }

  return validateBundle(files);
}

export function collectPreviewUploadBundle(
  value: unknown,
  skillMdContent: string
): UploadBundleFile[] {
  const files = [createSkillMdFile(skillMdContent)];
  if (value === undefined) {
    return files;
  }
  if (!Array.isArray(value)) {
    throw error(400, 'files must be an array');
  }

  for (const entry of value) {
    if (
      !entry
      || typeof entry !== 'object'
      || !('path' in entry)
      || !('content' in entry)
      || typeof entry.path !== 'string'
      || typeof entry.content !== 'string'
    ) {
      throw error(400, 'Each preview file must include string path and content fields');
    }
    const path = validateUploadPath(entry.path);
    files.push({
      path,
      content: entry.content,
      size: new TextEncoder().encode(entry.content).byteLength,
    });
  }

  return validateBundle(files);
}

export async function computeUploadBundleMetadata(
  files: UploadBundleFile[]
): Promise<UploadBundleMetadata> {
  const skillMd = files.find((file) => file.path === 'SKILL.md');
  if (!skillMd) {
    throw error(400, 'SKILL.md is required');
  }

  const { fullHash, normalizedHash } = await computeSkillMdHashes(skillMd.content);
  const manifestFiles: UploadBundleMetadata['manifestFiles'] = await Promise.all(files.map(async (file) => ({
    path: file.path,
    sha: file.path === 'SKILL.md' ? fullHash : await computeSha256Hex(file.content),
    size: file.size,
    type: 'text' as const,
  })));

  return {
    hashes: {
      fullHash,
      normalizedHash,
      bundleExactHash: await computeExactBundleFingerprint(manifestFiles),
      bundleManifestHash: await computeBundleManifestHash(manifestFiles, normalizedHash),
    },
    manifestFiles,
  };
}

export function buildUploadBundleFileTree(files: UploadBundleFile[]): { fileTree: FileNode[] } {
  const roots: FileNode[] = [];

  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const parts = file.path.split('/');
    let level = roots;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      const isLeaf = index === parts.length - 1;
      let node = level.find((candidate) => candidate.name === name);
      if (!node) {
        node = {
          name,
          path: currentPath,
          type: isLeaf ? 'file' : 'directory',
          ...(isLeaf ? { size: file.size } : { children: [] }),
        };
        level.push(node);
      }
      if (!isLeaf) {
        node.type = 'directory';
        node.children ||= [];
        level = node.children;
      }
    }
  }

  return { fileTree: roots };
}
