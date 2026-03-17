import type { FileNode } from '$lib/types';
import type { SkillFile } from '$lib/server/skill/files';
import { buildUploadSkillR2Key, buildUploadSkillR2Prefix } from '$lib/skill-path';

export interface OpenClawCompatVersionEntry {
  version: string;
  createdAt: number;
  changelog: string;
  changelogSource: 'auto' | 'user' | null;
  license: 'MIT-0' | null;
  fingerprint: string | null;
}

export interface OpenClawCompatManifest {
  schemaVersion: 1;
  compatSlug: string;
  nativeSlug: string;
  ownerHandle: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  deletedAt: number | null;
  tags: Record<string, string>;
  versions: OpenClawCompatVersionEntry[];
}

const OPENCLAW_MANIFEST_PREFIX = 'openclaw/manifests/';
const OPENCLAW_VERSION_PREFIX = 'openclaw/versions/';

function encodeKeySegment(value: string): string {
  return encodeURIComponent(value).replace(/%2F/g, '/');
}

export function buildOpenClawManifestKey(compatSlug: string): string {
  return `${OPENCLAW_MANIFEST_PREFIX}${encodeKeySegment(compatSlug)}.json`;
}

export function buildOpenClawVersionPrefix(compatSlug: string, version: string): string {
  return `${OPENCLAW_VERSION_PREFIX}${encodeKeySegment(compatSlug)}/${encodeKeySegment(version)}/`;
}

async function listAllObjects(r2: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const listed = await r2.list({ prefix, cursor });
    objects.push(...listed.objects);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return objects;
}

export async function deleteOpenClawPrefix(r2: R2Bucket, prefix: string): Promise<void> {
  const objects = await listAllObjects(r2, prefix);
  await Promise.all(objects.map((object) => r2.delete(object.key)));
}

async function listTextFilesFromPrefix(r2: R2Bucket, prefix: string): Promise<SkillFile[]> {
  const objects = await listAllObjects(r2, prefix);
  const files = await Promise.all(
    objects.map(async (object) => {
      const relativePath = object.key.slice(prefix.length);
      if (!relativePath) return null;
      const data = await r2.get(object.key);
      if (!data) return null;
      return {
        path: relativePath,
        content: await data.text(),
      } satisfies SkillFile;
    })
  );

  return files.filter((file): file is SkillFile => Boolean(file)).sort((a, b) => a.path.localeCompare(b.path));
}

export async function readOpenClawManifest(
  r2: R2Bucket | undefined,
  compatSlug: string
): Promise<OpenClawCompatManifest | null> {
  if (!r2) return null;

  const object = await r2.get(buildOpenClawManifestKey(compatSlug));
  if (!object) return null;

  try {
    const parsed = JSON.parse(await object.text()) as Partial<OpenClawCompatManifest>;
    if (parsed.schemaVersion !== 1) return null;
    if (typeof parsed.compatSlug !== 'string' || typeof parsed.nativeSlug !== 'string') return null;
    if (!Array.isArray(parsed.versions)) return null;

    const versions = parsed.versions
      .filter(
        (entry): entry is OpenClawCompatVersionEntry =>
          Boolean(
            entry &&
              typeof entry.version === 'string' &&
              typeof entry.createdAt === 'number' &&
              typeof entry.changelog === 'string'
          )
      )
      .sort((a, b) => b.createdAt - a.createdAt || b.version.localeCompare(a.version));

    return {
      schemaVersion: 1,
      compatSlug: parsed.compatSlug,
      nativeSlug: parsed.nativeSlug,
      ownerHandle: typeof parsed.ownerHandle === 'string' ? parsed.ownerHandle : null,
      createdAt: Number(parsed.createdAt ?? 0),
      updatedAt: Number(parsed.updatedAt ?? 0),
      deleted: Boolean(parsed.deleted),
      deletedAt: typeof parsed.deletedAt === 'number' ? parsed.deletedAt : null,
      tags: parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {},
      versions,
    };
  } catch {
    return null;
  }
}

export async function writeOpenClawManifest(
  r2: R2Bucket,
  manifest: OpenClawCompatManifest
): Promise<void> {
  const normalized: OpenClawCompatManifest = {
    ...manifest,
    versions: [...manifest.versions].sort(
      (a, b) => b.createdAt - a.createdAt || b.version.localeCompare(a.version)
    ),
  };

  await r2.put(buildOpenClawManifestKey(manifest.compatSlug), JSON.stringify(normalized, null, 2), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
  });
}

export function getOpenClawManifestLatestVersion(
  manifest: OpenClawCompatManifest | null | undefined
): OpenClawCompatVersionEntry | null {
  if (!manifest?.versions?.length) return null;

  const tagged = manifest.tags.latest
    ? manifest.versions.find((entry) => entry.version === manifest.tags.latest) || null
    : null;

  return tagged || manifest.versions[0] || null;
}

export function getOpenClawManifestVersion(
  manifest: OpenClawCompatManifest | null | undefined,
  version: string | null | undefined,
  tag: string | null | undefined
): OpenClawCompatVersionEntry | null {
  if (!manifest?.versions?.length) return null;

  if (version) {
    return manifest.versions.find((entry) => entry.version === version) || null;
  }

  if (tag) {
    const taggedVersion = manifest.tags[tag];
    if (!taggedVersion) return null;
    return manifest.versions.find((entry) => entry.version === taggedVersion) || null;
  }

  return getOpenClawManifestLatestVersion(manifest);
}

export async function snapshotOpenClawVersionFiles(
  r2: R2Bucket,
  compatSlug: string,
  version: string,
  files: SkillFile[]
): Promise<void> {
  const prefix = buildOpenClawVersionPrefix(compatSlug, version);
  await deleteOpenClawPrefix(r2, prefix);

  await Promise.all(
    files.map((file) =>
      r2.put(`${prefix}${file.path}`, file.content, {
        httpMetadata: {
          contentType: 'text/plain; charset=utf-8',
        },
      })
    )
  );
}

export async function readOpenClawVersionFiles(
  r2: R2Bucket | undefined,
  compatSlug: string,
  version: string
): Promise<SkillFile[]> {
  if (!r2) return [];
  return listTextFilesFromPrefix(r2, buildOpenClawVersionPrefix(compatSlug, version));
}

export async function replaceOpenClawCurrentFiles(
  r2: R2Bucket,
  nativeSlug: string,
  files: SkillFile[]
): Promise<void> {
  const prefix = buildUploadSkillR2Prefix(nativeSlug);
  if (!prefix) {
    throw new Error('Invalid native skill slug.');
  }

  await deleteOpenClawPrefix(r2, prefix);
  await Promise.all(
    files.map((file) =>
      r2.put(buildUploadSkillR2Key(nativeSlug, file.path), file.content, {
        httpMetadata: {
          contentType: 'text/plain; charset=utf-8',
        },
      })
    )
  );
}

export function buildOpenClawFileTree(files: Array<{ path: string; size?: number }>): { fileTree: FileNode[] } {
  const roots: FileNode[] = [];

  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/').filter(Boolean);
    let level = roots;
    let currentPath = '';

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;

      let node = level.find((candidate) => candidate.name === part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isLeaf ? 'file' : 'directory',
          ...(isLeaf && typeof file.size === 'number' ? { size: file.size } : {}),
          ...(!isLeaf ? { children: [] } : {}),
        };
        level.push(node);
      }

      if (!isLeaf) {
        node.type = 'directory';
        if (!node.children) {
          node.children = [];
        }
        level = node.children;
      }
    }
  }

  return { fileTree: roots };
}

export function findOpenClawReadme(files: SkillFile[]): SkillFile | null {
  const skillMd =
    files.find((file) => file.path.toLowerCase() === 'skill.md') ||
    files.find((file) => file.path.toLowerCase() === 'skills.md') ||
    null;
  return skillMd;
}
