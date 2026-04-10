import { getBlob, getRepo, getTreeRecursive } from '$lib/server/github-client/rest';
import { buildGithubSkillR2Prefixes, buildUploadSkillR2Prefix } from '$lib/skill-path';
import { buildBundleExpectationFromFileTree, chooseBestR2Bundle } from '$lib/server/skill/r2-bundle';
import { resolveSkillRelativePath } from '$lib/server/skill/scope';
import type { SkillDetail } from '$lib/types';
import type { SkillFile } from '$lib/server/skill/files';

interface GitHubRepoInfo {
  default_branch: string;
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated?: boolean;
}

function normalizeBundlePath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();

  if (normalized.toLowerCase() === 'skill.md') {
    return 'SKILL.md';
  }

  return normalized;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\n/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function decodeUtf8Text(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded.includes('\u0000') ? null : decoded;
  } catch {
    return null;
  }
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

async function readAllTextFilesFromR2(r2: R2Bucket | undefined, prefix: string): Promise<SkillFile[]> {
  if (!r2 || !prefix) return [];

  const objects = await listAllObjects(r2, prefix);
  const files = await Promise.all(
    objects.map(async (object) => {
      const relativePath = normalizeBundlePath(object.key.slice(prefix.length));
      if (!relativePath) return null;

      const data = await r2.get(object.key);
      if (!data) return null;

      const arrayBuffer = await data.arrayBuffer();
      const content = decodeUtf8Text(new Uint8Array(arrayBuffer));
      if (content === null) return null;

      return {
        path: relativePath,
        content,
      } satisfies SkillFile;
    })
  );

  return files
    .filter((file): file is SkillFile => Boolean(file))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function fetchGitHubBundleFiles(
  skill: Pick<SkillDetail, 'repoOwner' | 'repoName' | 'skillPath' | 'readme'>,
  githubToken?: string,
  githubRateLimitKV?: KVNamespace
): Promise<SkillFile[]> {
  if (!skill.repoOwner || !skill.repoName) {
    throw new Error('GitHub-backed skill is missing repository coordinates.');
  }

  const requestOptions = {
    token: githubToken,
    rateLimitKV: githubRateLimitKV,
    userAgent: 'SkillsCat-OpenClaw/1.0',
  };

  const repoResponse = await getRepo(skill.repoOwner, skill.repoName, requestOptions);
  if (!repoResponse.ok) {
    throw new Error(`Failed to fetch repository metadata: ${repoResponse.status}`);
  }

  const repo = (await repoResponse.json()) as GitHubRepoInfo;
  if (!repo.default_branch) {
    throw new Error('Repository default branch is unavailable.');
  }

  const treeResponse = await getTreeRecursive(
    skill.repoOwner,
    skill.repoName,
    repo.default_branch,
    requestOptions
  );
  if (!treeResponse.ok) {
    throw new Error(`Failed to fetch repository tree: ${treeResponse.status}`);
  }

  const tree = (await treeResponse.json()) as GitHubTreeResponse;
  if (tree.truncated) {
    throw new Error('Repository tree is truncated; cannot build a full ClawHub-compatible bundle.');
  }

  const candidates = tree.tree
    .filter((item) => item.type === 'blob')
    .map((item) => {
      const scopedPath = resolveSkillRelativePath(item.path, skill.skillPath);
      if (!scopedPath) return null;
      const relativePath = normalizeBundlePath(scopedPath);
      return relativePath ? { sha: item.sha, path: relativePath } : null;
    })
    .filter((item): item is { sha: string; path: string } => Boolean(item))
    .sort((a, b) => a.path.localeCompare(b.path));

  const files: SkillFile[] = [];

  for (const candidate of candidates) {
    const blobResponse = await getBlob(skill.repoOwner, skill.repoName, candidate.sha, requestOptions);
    if (!blobResponse.ok) {
      throw new Error(`Failed to fetch blob for ${candidate.path}: ${blobResponse.status}`);
    }

    const blob = (await blobResponse.json()) as { content?: string; encoding?: string };
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
      throw new Error(`Unsupported blob encoding for ${candidate.path}.`);
    }

    const content = decodeUtf8Text(decodeBase64ToBytes(blob.content));
    if (content === null) continue;

    files.push({
      path: candidate.path,
      content,
    });
  }

  if (!files.some((file) => file.path === 'SKILL.md') && skill.readme) {
    files.unshift({
      path: 'SKILL.md',
      content: skill.readme,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function resolveOpenClawBundleFiles(input: {
  skill: Pick<
    SkillDetail,
    'slug' | 'repoOwner' | 'repoName' | 'skillPath' | 'readme' | 'sourceType' | 'fileStructure'
  >;
  r2: R2Bucket | undefined;
  githubToken?: string;
  githubRateLimitKV?: KVNamespace;
}): Promise<SkillFile[]> {
  const { skill, r2, githubToken, githubRateLimitKV } = input;

  if (skill.sourceType === 'upload') {
    const prefix = buildUploadSkillR2Prefix(skill.slug);
    const files = await readAllTextFilesFromR2(r2, prefix);

    if (files.length > 0) {
      return files;
    }

    if (skill.readme) {
      return [{ path: 'SKILL.md', content: skill.readme }];
    }

    throw new Error('Uploaded skill bundle is unavailable.');
  }

  if (r2 && skill.repoOwner && skill.repoName) {
    const candidates: Array<{ files: SkillFile[]; index: number }> = [];

    for (const [index, prefix] of buildGithubSkillR2Prefixes(skill.repoOwner, skill.repoName, skill.skillPath).entries()) {
      const cachedFiles = await readAllTextFilesFromR2(r2, prefix);
      if (cachedFiles.length === 0) {
        continue;
      }
      candidates.push({ files: cachedFiles, index });
    }

    const selected = chooseBestR2Bundle(candidates, buildBundleExpectationFromFileTree(skill.fileStructure));
    if (selected.complete && selected.files.length > 0) {
      return selected.files;
    }
  }

  return fetchGitHubBundleFiles(skill, githubToken, githubRateLimitKV);
}
