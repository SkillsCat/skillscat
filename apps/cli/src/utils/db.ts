import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getConfigDir, getInstalledSkillsDb } from './paths.js';
import type { RepoSource } from './source.js';

export interface InstalledSkill {
  name: string;
  description: string;
  source: RepoSource;
  agents: string[];
  global: boolean;
  installedAt: number;
  sha?: string;
  path: string;
}

export interface InstalledSkillsDb {
  version: number;
  skills: InstalledSkill[];
}

function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

function loadDb(): InstalledSkillsDb {
  const dbPath = getInstalledSkillsDb();

  if (!existsSync(dbPath)) {
    return { version: 1, skills: [] };
  }

  try {
    const content = readFileSync(dbPath, 'utf-8');
    return JSON.parse(content) as InstalledSkillsDb;
  } catch {
    return { version: 1, skills: [] };
  }
}

function saveDb(db: InstalledSkillsDb): void {
  ensureConfigDir();
  const dbPath = getInstalledSkillsDb();
  writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

/**
 * Record a skill installation
 */
export function recordInstallation(skill: InstalledSkill): void {
  const db = loadDb();

  // Remove existing entry for same skill
  db.skills = db.skills.filter(
    s => !(s.name === skill.name && s.source.owner === skill.source.owner && s.source.repo === skill.source.repo)
  );

  db.skills.push(skill);
  saveDb(db);
}

/**
 * Remove a skill record
 */
export function removeInstallation(skillName: string, source?: RepoSource): void {
  const db = loadDb();

  if (source) {
    db.skills = db.skills.filter(
      s => !(s.name === skillName && s.source.owner === source.owner && s.source.repo === source.repo)
    );
  } else {
    db.skills = db.skills.filter(s => s.name !== skillName);
  }

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
      s => s.name === skillName && s.source.owner === source.owner && s.source.repo === source.repo
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
