import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getInstalledDbPath, ensureConfigDir } from '../config/config';
import type { RepoSource } from '../source/source';

export type UpdateStrategy = 'git' | 'registry';

export interface InstalledSkill {
  name: string;
  description: string;
  source?: RepoSource;
  registrySlug?: string;
  updateStrategy?: UpdateStrategy;
  agents: string[];
  global: boolean;
  installedAt: number;
  sha?: string;
  path: string;
  contentHash?: string;
}

export interface InstalledSkillsDb {
  version: number;
  skills: InstalledSkill[];
}

const CURRENT_DB_VERSION = 2;

function defaultDb(): InstalledSkillsDb {
  return { version: CURRENT_DB_VERSION, skills: [] };
}

function normalizeSource(raw: unknown): RepoSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Partial<RepoSource>;

  if (
    (source.platform !== 'github' && source.platform !== 'gitlab') ||
    typeof source.owner !== 'string' ||
    typeof source.repo !== 'string'
  ) {
    return undefined;
  }

  return {
    platform: source.platform,
    owner: source.owner,
    repo: source.repo,
    branch: typeof source.branch === 'string' ? source.branch : undefined,
    path: typeof source.path === 'string' ? source.path : undefined,
  };
}

function getUpdateStrategy(skill: Pick<InstalledSkill, 'updateStrategy' | 'registrySlug'>): UpdateStrategy {
  if (skill.updateStrategy === 'registry') return 'registry';
  if (skill.updateStrategy === 'git') return 'git';
  return skill.registrySlug ? 'registry' : 'git';
}

function normalizeSkill(raw: unknown): InstalledSkill | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<InstalledSkill>;

  if (typeof candidate.name !== 'string') return null;
  if (!Array.isArray(candidate.agents)) return null;
  if (typeof candidate.global !== 'boolean') return null;
  if (typeof candidate.installedAt !== 'number') return null;

  const path = typeof candidate.path === 'string' && candidate.path ? candidate.path : 'SKILL.md';
  const registrySlug = typeof candidate.registrySlug === 'string' ? candidate.registrySlug : undefined;
  const source = normalizeSource(candidate.source);

  return {
    name: candidate.name,
    description: typeof candidate.description === 'string' ? candidate.description : '',
    source,
    registrySlug,
    updateStrategy: getUpdateStrategy({
      updateStrategy: candidate.updateStrategy,
      registrySlug,
    }),
    agents: Array.from(new Set(candidate.agents.filter((id): id is string => typeof id === 'string'))),
    global: candidate.global,
    installedAt: candidate.installedAt,
    sha: typeof candidate.sha === 'string' ? candidate.sha : undefined,
    path,
    contentHash: typeof candidate.contentHash === 'string' ? candidate.contentHash : undefined,
  };
}

function loadDb(): InstalledSkillsDb {
  const dbPath = getInstalledDbPath();

  if (!existsSync(dbPath)) {
    return defaultDb();
  }

  try {
    const content = readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<InstalledSkillsDb> | null;
    if (!parsed || !Array.isArray(parsed.skills)) {
      return defaultDb();
    }

    const normalized = parsed.skills
      .map((skill) => normalizeSkill(skill))
      .filter((skill): skill is InstalledSkill => skill !== null);

    return {
      version: CURRENT_DB_VERSION,
      skills: normalized,
    };
  } catch {
    return defaultDb();
  }
}

function saveDb(db: InstalledSkillsDb): void {
  ensureConfigDir();
  const dbPath = getInstalledDbPath();
  writeFileSync(
    dbPath,
    JSON.stringify({ version: CURRENT_DB_VERSION, skills: db.skills }, null, 2),
    'utf-8'
  );
}

function sameSource(a?: RepoSource, b?: RepoSource): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.platform === b.platform &&
    a.owner === b.owner &&
    a.repo === b.repo &&
    (a.branch ?? '') === (b.branch ?? '') &&
    (a.path ?? '') === (b.path ?? '')
  );
}

function sameInstallationIdentity(a: InstalledSkill, b: InstalledSkill): boolean {
  return (
    a.name === b.name &&
    a.global === b.global &&
    a.path === b.path &&
    (a.registrySlug ?? '') === (b.registrySlug ?? '') &&
    getUpdateStrategy(a) === getUpdateStrategy(b) &&
    sameSource(a.source, b.source)
  );
}

/**
 * Record a skill installation
 */
export function recordInstallation(skill: InstalledSkill): void {
  const db = loadDb();
  const normalized = normalizeSkill(skill);
  if (!normalized) {
    return;
  }

  // Replace only exact same installation identity.
  db.skills = db.skills.filter((existing) => !sameInstallationIdentity(existing, normalized));

  db.skills.push(normalized);
  saveDb(db);
}

/**
 * Remove a skill record
 */
export function removeInstallation(
  skillName: string,
  options?: {
    source?: RepoSource;
    agents?: string[];
    global?: boolean;
  }
): void {
  const db = loadDb();
  const targetAgents = options?.agents;

  db.skills = db.skills.flatMap((skill) => {
    if (skill.name !== skillName) {
      return [skill];
    }

    if (options?.source) {
      if (!sameSource(skill.source, options.source)) {
        return [skill];
      }
    }

    if (options?.global !== undefined && skill.global !== options.global) {
      return [skill];
    }

    if (targetAgents && targetAgents.length > 0) {
      const remainingAgents = skill.agents.filter((agentId) => !targetAgents.includes(agentId));
      if (remainingAgents.length === 0) {
        return [];
      }
      return [{ ...skill, agents: remainingAgents }];
    }

    return [];
  });

  saveDb(db);
}

/**
 * Get all installed skills
 */
export function getInstalledSkills(): InstalledSkill[] {
  const db = loadDb();
  return db.skills;
}

/**
 * Get installed skill by name
 */
export function getInstalledSkill(skillName: string): InstalledSkill | undefined {
  const db = loadDb();
  return db.skills.find(s => s.name === skillName);
}

/**
 * Check if a skill is installed
 */
export function isSkillInstalled(skillName: string, source?: RepoSource): boolean {
  const db = loadDb();

  if (source) {
    return db.skills.some(
      s => s.name === skillName && !!s.source && sameSource(s.source, source)
    );
  }

  return db.skills.some(s => s.name === skillName);
}

/**
 * Get skills that need updates
 */
export function getSkillsNeedingUpdate(skills: InstalledSkill[], updates: Map<string, string>): InstalledSkill[] {
  return skills.filter(skill => {
    const latestSha = updates.get(skill.name);
    return latestSha && latestSha !== skill.sha;
  });
}
