import type { FileNode } from '$lib/types';

export interface BundleExpectation {
  paths: string[];
  structured: boolean;
}

export interface BundleCandidate<TFile extends { path: string }> {
  files: TFile[];
  index: number;
}

export interface BundleSelectionResult<TFile extends { path: string }> {
  files: TFile[];
  complete: boolean;
}

interface RawFileStructure {
  files?: Array<{
    path?: string | null;
    type?: string | null;
  }>;
}

const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp',
  'html', 'css', 'scss', 'less', 'sass',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'xml', 'svg', 'sql', 'graphql', 'gql',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'svelte', 'vue', 'astro'
]);

function normalizeBundlePath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();

  return normalized.toLowerCase() === 'skill.md' ? 'SKILL.md' : normalized;
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(
    paths
      .map((path) => normalizeBundlePath(path))
      .filter(Boolean)
  )];
}

function isLikelyTextBundlePath(path: string): boolean {
  const normalizedPath = normalizeBundlePath(path);
  const fileName = normalizedPath.split('/').pop()?.toLowerCase() || '';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (!ext || TEXT_EXTENSIONS.has(ext)) return true;
  if (['dockerfile', 'makefile', 'readme', 'license', 'changelog'].includes(fileName)) return true;
  return false;
}

function flattenFileTree(nodes: FileNode[] | null | undefined): string[] {
  if (!nodes || nodes.length === 0) return [];

  const paths: string[] = [];
  const stack = [...nodes];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (current.type === 'file') {
      paths.push(current.path);
      continue;
    }

    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.push(...current.children);
    }
  }

  return paths;
}

export function buildBundleExpectationFromRawFileStructure(fileStructureRaw: string | null): BundleExpectation {
  if (!fileStructureRaw) {
    return { paths: ['SKILL.md'], structured: false };
  }

  try {
    const parsed = JSON.parse(fileStructureRaw) as RawFileStructure;
    const paths = dedupePaths((parsed.files || [])
      .filter((file) => {
        if (file.type === 'binary') return false;
        const path = String(file.path || '');
        if (file.type === 'text') return Boolean(path);
        return isLikelyTextBundlePath(path);
      })
      .map((file) => String(file.path || '')));

    if (paths.length > 0) {
      return { paths, structured: true };
    }
  } catch {
    // Fall back to the minimal expectation below.
  }

  return { paths: ['SKILL.md'], structured: false };
}

export function buildBundleExpectationFromFileTree(fileTree: FileNode[] | null | undefined): BundleExpectation {
  const paths = dedupePaths(flattenFileTree(fileTree).filter((path) => isLikelyTextBundlePath(path)));

  if (paths.length > 0) {
    return { paths, structured: true };
  }

  return { paths: ['SKILL.md'], structured: false };
}

export function chooseBestR2Bundle<TFile extends { path: string }>(
  candidates: BundleCandidate<TFile>[],
  expectation: BundleExpectation
): BundleSelectionResult<TFile> {
  if (candidates.length === 0) {
    return { files: [], complete: false };
  }

  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    normalizedPaths: new Set(candidate.files.map((file) => normalizeBundlePath(file.path))),
  }));

  const expectedPaths = dedupePaths(expectation.paths);
  const effectiveExpectedCount = expectedPaths.length;
  let best = normalizedCandidates[0];
  let bestMatched = -1;
  let bestComplete = false;
  let bestUnexpected = Number.POSITIVE_INFINITY;
  let bestHasSkillMd = false;

  for (const candidate of normalizedCandidates) {
    const matchedExpectedCount = expectedPaths.reduce(
      (count, path) => count + (candidate.normalizedPaths.has(path) ? 1 : 0),
      0
    );
    const complete = effectiveExpectedCount > 0 && matchedExpectedCount === effectiveExpectedCount;
    const unexpectedCount = Math.max(0, candidate.files.length - matchedExpectedCount);
    const hasSkillMd = candidate.normalizedPaths.has('SKILL.md');

    const shouldReplace =
      (complete ? 1 : 0) > (bestComplete ? 1 : 0)
      || (
        complete === bestComplete
        && matchedExpectedCount > bestMatched
      )
      || (
        complete === bestComplete
        && matchedExpectedCount === bestMatched
        && expectation.structured
        && unexpectedCount < bestUnexpected
      )
      || (
        complete === bestComplete
        && matchedExpectedCount === bestMatched
        && (
          !expectation.structured
          || unexpectedCount === bestUnexpected
        )
        && candidate.files.length > best.files.length
      )
      || (
        complete === bestComplete
        && matchedExpectedCount === bestMatched
        && unexpectedCount === bestUnexpected
        && candidate.files.length === best.files.length
        && (hasSkillMd ? 1 : 0) > (bestHasSkillMd ? 1 : 0)
      )
      || (
        complete === bestComplete
        && matchedExpectedCount === bestMatched
        && unexpectedCount === bestUnexpected
        && candidate.files.length === best.files.length
        && hasSkillMd === bestHasSkillMd
        && candidate.index < best.index
      );

    if (shouldReplace) {
      best = candidate;
      bestMatched = matchedExpectedCount;
      bestComplete = complete;
      bestUnexpected = unexpectedCount;
      bestHasSkillMd = hasSkillMd;
    }
  }

  return {
    files: best.files,
    complete: bestComplete || (effectiveExpectedCount === 0 && bestHasSkillMd),
  };
}
