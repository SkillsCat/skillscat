import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseSkillFrontmatter, type SkillInfo } from './source';
import { calculateContentHash } from '../storage/cache';
import { normalizeCompanionRelativePath } from '../storage/skill-files';

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.svelte-kit', '.wrangler', '.cache']);
const SKIPPED_FILES = new Set(['.DS_Store', '.skillscat-companion-files.json']);
const MAX_ENTRIES = 50_000;
const MAX_DEPTH = 64;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const MAX_BUNDLE_FILES = 1_000;

export interface LocalSkill extends SkillInfo {
  directory: string;
}

export function isLocalSource(source: string): boolean {
  return source === '.' || source === '..' || source.startsWith('./') || source.startsWith('../')
    || source.startsWith('.\\') || source.startsWith('..\\') || isAbsolute(source)
    || (!/[\\/]/.test(source) && existsSync(source));
}

function readSkill(directory: string): LocalSkill | null {
  const requestedPath = join(directory, 'SKILL.md');
  const stat = lstatSync(requestedPath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const path = realpathSync(requestedPath);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  const metadata = parseSkillFrontmatter(content);
  if (!metadata) return null;
  return { name: metadata.name, description: metadata.description, path, directory, content,
    contentHash: calculateContentHash(content) };
}

/** Discover definitions first; companion files are loaded only for selected skills. */
export function discoverLocalSkills(source: string, options: { excludeDirectories?: string[] } = {}): { root: string; skills: LocalSkill[]; warnings: string[] } {
  const requestedRoot = resolve(source);
  if (!lstatSync(requestedRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Local source must be a directory (symbolic links are not followed): ${requestedRoot}`);
  }
  const root = realpathSync(requestedRoot);
  const skills: LocalSkill[] = [];
  const warnings: string[] = [];
  const excluded = new Set(options.excludeDirectories?.map((path) => existsSync(path) ? realpathSync(path) : resolve(path)));
  let entriesSeen = 0;
  let definitionBytes = 0;
  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error(`Local discovery exceeded ${MAX_DEPTH} directory levels.`);
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      warnings.push(`Could not read ${relative(root, directory) || '.'}`);
      return;
    }
    entriesSeen += entries.length;
    if (entriesSeen > MAX_ENTRIES) throw new Error('Local discovery limit reached. Choose a smaller source directory.');
    if (entries.some((entry) => entry.name === 'SKILL.md' && entry.isFile())) {
      try {
        const skill = readSkill(directory);
        if (skill) {
          definitionBytes += Buffer.byteLength(skill.content);
          if (definitionBytes > MAX_BUNDLE_BYTES) throw new RangeError('Local skill definitions exceed 50 MiB. Choose a smaller source directory.');
          skills.push(skill);
        }
        else warnings.push(`Skipped invalid or oversized SKILL.md: ${relative(root, directory) || '.'}`);
      } catch (err) {
        if (err instanceof RangeError) throw err;
        warnings.push(`Could not read SKILL.md: ${relative(root, directory) || '.'}`);
      }
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.skillscat-txn-') && !excluded.has(path)) walk(path, depth + 1);
    }
  };
  walk(root, 0);
  return { root, skills, warnings };
}

/** Snapshot a bundle before writes; nested skills remain independent bundles. */
export function loadLocalSkill(directory: string): LocalSkill {
  const requestedRoot = resolve(directory);
  if (!lstatSync(requestedRoot, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Local skill directory unavailable: ${requestedRoot}`);
  const root = realpathSync(requestedRoot);
  const skill = readSkill(root);
  if (!skill) throw new Error(`Valid SKILL.md not found at ${root}`);
  const files: NonNullable<SkillInfo['companionFiles']> = [];
  const filePaths = new Set<string>();
  let totalBytes = Buffer.byteLength(skill.content);
  let entriesSeen = 0;
  const walk = (path: string, depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error(`Skill bundle exceeded ${MAX_DEPTH} directory levels.`);
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    entriesSeen += entries.length;
    if (entriesSeen > MAX_ENTRIES) throw new Error(`Skill bundle discovery limit reached: ${skill.name}`);
    if (path !== root && entries.some((entry) => entry.name.toLowerCase() === 'skill.md')) return;
    for (const entry of entries) {
      if (SKIPPED_DIRECTORIES.has(entry.name) || SKIPPED_FILES.has(entry.name) || entry.name.startsWith('.skillscat-txn-')) continue;
      const absolutePath = join(path, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, depth + 1);
      } else if (entry.isFile() && absolutePath !== skill.path) {
        const stat = lstatSync(absolutePath);
        totalBytes += stat.size;
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES || totalBytes > MAX_BUNDLE_BYTES || files.length >= MAX_BUNDLE_FILES) {
          throw new Error(`Skill bundle exceeds local installation limits: ${skill.name}`);
        }
        const filePath = relative(root, absolutePath).split(sep).join('/');
        const normalized = normalizeCompanionRelativePath(filePath);
        const key = filePath.toLowerCase();
        if (!normalized || normalized !== filePath || key === 'skill.md' || /[\x00-\x1f\x7f]/.test(filePath) || filePaths.has(key)) {
          throw new Error(`Unsupported companion file path: ${filePath}`);
        }
        filePaths.add(key);
        files.push({ path: filePath, content: readFileSync(absolutePath), mode: stat.mode & 0o777 });
      }
    }
  };
  walk(root, 0);
  return { ...skill, companionFiles: files };
}
