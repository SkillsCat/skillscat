import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { SkillCompanionFile, SkillInfo } from '../source/source';

const COMPANION_MANIFEST_FILE = '.skillscat-companion-files.json';
const COMPANION_MANIFEST_VERSION = 1;

export function companionFilesAreUpToDate(
  skillDir: string,
  skill: SkillInfo,
  options?: { skipValidation?: boolean }
): boolean {
  if (options?.skipValidation) {
    return true;
  }

  const expectedPaths = getExpectedCompanionPaths(skill);
  const manifestPaths = readCompanionManifest(skillDir);

  if (expectedPaths.length === 0) {
    if (manifestPaths && manifestPaths.length > 0) {
      return false;
    }
    return true;
  }

  // Force one rewrite for legacy installs without manifest so we can record managed files.
  if (!manifestPaths) {
    return false;
  }
  if (!sameStringArrays(manifestPaths, expectedPaths)) {
    return false;
  }

  for (const file of getExpectedCompanionFiles(skill)) {
    const destination = join(skillDir, file.path);
    if (!existsSync(destination)) {
      return false;
    }

    try {
      const existing = readFileSync(destination);
      const expected = Buffer.from(file.content);
      if (!existing.equals(expected)) {
        return false;
      }
      if (file.mode !== undefined && process.platform !== 'win32' && (lstatSync(destination).mode & 0o777) !== file.mode) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function syncCompanionFiles(skillDir: string, skill: SkillInfo, options: { strict?: boolean } = {}): void {
  assertSkillFilesSafe(skillDir, skill);
  const expectedFiles = getExpectedCompanionFiles(skill);
  const expectedPaths = expectedFiles.map((file) => file.path);
  const previousPaths = readCompanionManifest(skillDir) ?? [];

  for (const stalePath of previousPaths) {
    if (expectedPaths.includes(stalePath)) {
      continue;
    }
    const destination = join(skillDir, stalePath);
    try {
      rmSync(destination, { force: true });
      pruneEmptyParentDirs(skillDir, destination);
    } catch (err) {
      if (options.strict) throw err;
      // Best-effort cleanup only; write phase below still proceeds.
    }
  }

  for (const file of expectedFiles) {
    const destination = join(skillDir, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    if (options.strict) rmSync(destination, { force: true });
    writeFileSync(destination, Buffer.from(file.content));
    if (file.mode !== undefined && process.platform !== 'win32') chmodSync(destination, file.mode);
  }

  writeCompanionManifest(skillDir, expectedPaths, options.strict);
}

/** Prepare a complete local bundle before replacing its destination. Roll back a failed swap. */
export function writeLocalSkillBundle(skillDir: string, skill: SkillInfo): void {
  assertSkillFilesSafe(skillDir, skill);
  mkdirSync(dirname(skillDir), { recursive: true });
  const transaction = mkdtempSync(join(dirname(skillDir), '.skillscat-txn-'));
  const next = join(transaction, 'next');
  const previous = join(transaction, 'previous');
  let backedUp = false;
  let preserveBackup = false;
  try {
    if (existsSync(skillDir)) {
      cpSync(skillDir, next, { recursive: true, dereference: false, verbatimSymlinks: true });
    } else {
      mkdirSync(next);
    }
    assertSkillFilesSafe(next, skill);
    rmSync(join(next, 'SKILL.md'), { force: true });
    writeFileSync(join(next, 'SKILL.md'), skill.content, 'utf-8');
    syncCompanionFiles(next, skill, { strict: true });
    assertSkillFilesSafe(skillDir, skill);
    if (existsSync(skillDir)) {
      renameSync(skillDir, previous);
      backedUp = true;
    }
    try {
      renameSync(next, skillDir);
    } catch (err) {
      if (backedUp) {
        try { renameSync(previous, skillDir); }
        catch { preserveBackup = true; throw new Error(`Could not restore installation; original files preserved at ${previous}`, { cause: err }); }
      }
      throw err;
    }
  } finally {
    if (!preserveBackup) {
      try { rmSync(transaction, { recursive: true, force: true }); }
      catch { /* Keep any backup if cleanup is prevented by filesystem permissions. */ }
    }
  }
}

function getExpectedCompanionFiles(skill: SkillInfo): SkillCompanionFile[] {
  const files = skill.companionFiles ?? [];
  const deduped = new Map<string, SkillCompanionFile>();

  for (const file of files) {
    const normalized = normalizeCompanionRelativePath(file.path);
    if (!normalized || normalized.toLowerCase() === 'skill.md') continue;
    deduped.set(normalized, { ...file, path: normalized });
  }

  return Array.from(deduped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, file]) => file);
}

function getExpectedCompanionPaths(skill: SkillInfo): string[] {
  return getExpectedCompanionFiles(skill).map((file) => file.path);
}

function readCompanionManifest(skillDir: string): string[] | null {
  const manifestPath = join(skillDir, COMPANION_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      version?: number;
      files?: unknown;
    };

    if (parsed.version !== COMPANION_MANIFEST_VERSION || !Array.isArray(parsed.files)) {
      return null;
    }

    const validFiles = parsed.files
      .map((value) => (typeof value === 'string' ? normalizeCompanionRelativePath(value) : ''))
      .filter((value): value is string => Boolean(value) && value.toLowerCase() !== 'skill.md');

    validFiles.sort((a, b) => a.localeCompare(b));
    return Array.from(new Set(validFiles));
  } catch {
    return null;
  }
}

function writeCompanionManifest(skillDir: string, files: string[], strict = false): void {
  const manifestPath = join(skillDir, COMPANION_MANIFEST_FILE);
  const normalizedFiles = Array.from(new Set(files.map(normalizeCompanionRelativePath).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b));

  if (normalizedFiles.length === 0) {
    try {
      rmSync(manifestPath, { force: true });
    } catch (err) {
      if (strict) throw err;
      // Ignore cleanup failures.
    }
    return;
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({
    version: COMPANION_MANIFEST_VERSION,
    files: normalizedFiles,
  }, null, 2));
}

export function normalizeCompanionRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[:\x00]/.test(segment))) {
    return '';
  }
  if (segments.some((segment) => segment.toLowerCase() === COMPANION_MANIFEST_FILE)) {
    return '';
  }
  return segments.join('/');
}

function pruneEmptyParentDirs(skillDir: string, filePath: string): void {
  let current = dirname(filePath);
  while (current && current !== skillDir && current.startsWith(`${skillDir}`)) {
    try {
      const entries = readdirSync(current);
      if (entries.length > 0) {
        break;
      }
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

/** Refuse to follow local symlinks when replacing managed installation files. */
export function assertSkillFilesSafe(skillDir: string, skill: SkillInfo): void {
  // Include agent directory ancestors, such as a symlinked .claude/skills.
  const absoluteDir = resolve(skillDir);
  const cwd = process.cwd();
  const boundary = absoluteDir.startsWith(`${cwd}${sep}`) ? cwd : homedir();
  let ancestor = absoluteDir;
  while (ancestor !== boundary) {
    if (lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`Refusing to write through a symbolic link: ${ancestor}`);
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const checkPath = (path: string) => {
    let current = skillDir;
    for (const segment of ['', ...relative(skillDir, path).split(/[\\/]/).filter(Boolean)]) {
      current = join(current, segment);
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`Refusing to write through a symbolic link: ${current}`);
      }
    }
  };
  checkPath(join(skillDir, 'SKILL.md'));
  checkPath(join(skillDir, COMPANION_MANIFEST_FILE));
  for (const path of [...getExpectedCompanionPaths(skill), ...(readCompanionManifest(skillDir) ?? [])]) {
    checkPath(join(skillDir, path));
  }
}

function sameStringArrays(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
