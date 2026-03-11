import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { parseSource } from '../utils/source/source';
import {
  createGitHubRepoSnapshot,
  discoverSkills,
  fetchSkillCompanionFilesWithOptions,
  type GitHubRepoSnapshot,
} from '../utils/source/git';
import { fetchSkill, fetchSkillsByRepo, type RegistryRepoSkillSummary } from '../utils/api/registry';
import { submitRepoForIndexingInBackground } from '../utils/api/background-submit';
import {
  AGENTS,
  detectPreferredAgents,
  FALLBACK_AGENT_ID,
  getAgentBasePath,
  getAgentsByIds,
  getSkillPath,
  type Agent,
} from '../utils/agents/agents';
import { recordInstallation } from '../utils/storage/db';
import { trackInstallation } from '../utils/api/tracking';
import { success, error, warn, info, spinner, prompt } from '../utils/core/ui';
import { cacheSkill, getCachedSkill } from '../utils/storage/cache';
import { verboseLog } from '../utils/core/verbose';
import { isDefaultRegistry } from '../utils/config/config';
import type { SkillRegistryItem } from '../utils/api/registry';
import type { SkillInfo, RepoSource } from '../utils/source/source';

interface AddOptions {
  global?: boolean;
  agent?: string[];
  skill?: string[];
  list?: boolean;
  yes?: boolean;
  force?: boolean;
}

interface ResolvedInstallSkill {
  skill: SkillInfo;
  installSource?: RepoSource;
  registrySlug?: string;
  updateStrategy: 'git' | 'registry';
  trackingSlug: string;
  cacheOwner?: string;
  cacheRepo?: string;
  cachePath?: string;
  companionFilesHydrationFailed?: boolean;
}

type ResolveSelectionMode = 'default' | 'install-all';

interface ResolveInstallSkillsResult {
  resolved: ResolvedInstallSkill[];
  selectionMode: ResolveSelectionMode;
}

const COMPANION_MANIFEST_FILE = '.skillscat-companion-files.json';
const COMPANION_MANIFEST_VERSION = 1;

export async function add(source: string, options: AddOptions): Promise<void> {
  const repoSource = parseSource(source);
  if (!repoSource) {
    error('Invalid source. Supported formats:');
    console.log(pc.dim('  owner/repo'));
    console.log(pc.dim('  https://github.com/owner/repo'));
    console.log(pc.dim('  https://gitlab.com/owner/repo'));
    process.exit(1);
  }

  const sourceLabel = `${repoSource.owner}/${repoSource.repo}`;
  const isExplicitGitHubRefSource = repoSource.platform === 'github' && repoSource.hasExplicitRef === true;
  const githubSnapshot = createGitHubRepoSnapshot(repoSource);
  if (isExplicitGitHubRefSource) {
    verboseLog(`Explicit GitHub ${repoSource.refKind || 'ref'} source detected; using direct GitHub install path`);
  }

  info(`Fetching skills from ${pc.cyan(sourceLabel)}...`);

  const cached = getCachedSkill(repoSource.owner, repoSource.repo, repoSource.path);
  if (cached && !options.force) {
    verboseLog('Found cached skill content');
  }

  const discoverSpinner = spinner('Discovering skills');
  let resolvedSkills: ResolvedInstallSkill[] = [];
  let selectionMode: ResolveSelectionMode = 'default';

  try {
    const resolution = await resolveInstallSkills({
      sourceInput: source,
      repoSource,
      requestedSkillNames: options.skill ?? [],
      explicitRefBypassRegistry: isExplicitGitHubRefSource,
      githubSnapshot,
    });
    resolvedSkills = resolution.resolved;
    selectionMode = resolution.selectionMode;
  } catch (err) {
    discoverSpinner.stop(false);
    error(err instanceof Error ? err.message : 'Failed to discover skills');
    process.exit(1);
  }

  discoverSpinner.stop(true);

  if (resolvedSkills.length === 0) {
    warn('No skills found in this repository.');
    console.log(pc.dim('Make sure the repository contains SKILL.md files with valid frontmatter.'));
    process.exit(1);
  }

  const missingRequestedNames = getMissingRequestedNames(options.skill ?? [], resolvedSkills);
  if (missingRequestedNames.length > 0) {
    error(`No skills found matching: ${missingRequestedNames.join(', ')}`);
    if (resolvedSkills.length > 0) {
      console.log(pc.dim('Available skills:'));
      for (const entry of resolvedSkills) {
        console.log(pc.dim(`  - ${entry.skill.name}`));
      }
    }
    process.exit(1);
  }

  // List mode - just show skills and exit
  if (options.list) {
    console.log();
    console.log(pc.bold(`Found ${resolvedSkills.length} skill(s):`));
    console.log();

    for (const entry of resolvedSkills) {
      console.log(`  ${pc.cyan(entry.skill.name)}`);
      console.log(`  ${pc.dim(entry.skill.description)}`);
      console.log(`  ${pc.dim(`Path: ${entry.skill.path}`)}`);
      console.log();
    }

    console.log(pc.dim('─'.repeat(50)));
    console.log(pc.dim('Install with:'));
    console.log(`  ${pc.cyan(`npx skillscat add ${source}`)}`);
    return;
  }

  if (selectionMode === 'install-all' && !options.yes && (!options.skill || options.skill.length === 0)) {
    console.log();
    info(`No published skill slug matched ${pc.cyan(sourceLabel)}.`);
    console.log(pc.dim(`Found ${resolvedSkills.length} published skill(s) in repository ${sourceLabel}:`));
    for (const entry of resolvedSkills) {
      console.log(pc.dim(`  - ${entry.skill.name}${formatSkillPathHint(entry.skill.path)}`));
    }
    console.log();

    const confirm = await prompt(`Install all ${resolvedSkills.length} skill(s) from ${sourceLabel}? [y/N] `);
    if (confirm.trim().toLowerCase() !== 'y') {
      info('Installation cancelled.');
      process.exit(0);
    }
  }

  // Final name filter (safety net after mixed registry+git resolution)
  let selectedEntries = resolvedSkills;
  if (options.skill && options.skill.length > 0) {
    selectedEntries = resolvedSkills.filter((entry) =>
      options.skill!.some((name) => entry.skill.name.toLowerCase() === name.toLowerCase())
    );

    if (selectedEntries.length === 0) {
      error(`No skills found matching: ${options.skill.join(', ')}`);
      console.log(pc.dim('Available skills:'));
      for (const entry of resolvedSkills) {
        console.log(pc.dim(`  - ${entry.skill.name}`));
      }
      process.exit(1);
    }
  } else if (selectionMode !== 'install-all' && !options.yes && resolvedSkills.length > 1) {
    selectedEntries = [await selectSingleSkillInteractive(resolvedSkills)];
  }

  // Detect or select agents
  let targetAgents: Agent[];
  const isGlobal = options.global ?? false;
  let usedFallbackAgent = false;

  if (options.agent && options.agent.length > 0) {
    targetAgents = getAgentsByIds(options.agent);
    if (targetAgents.length === 0) {
      error(`Invalid agent(s): ${options.agent.join(', ')}`);
      console.log(pc.dim('Available agents:'));
      for (const agent of AGENTS) {
        console.log(pc.dim(`  - ${agent.id} (${agent.name})`));
      }
      process.exit(1);
    }
  } else {
    targetAgents = detectPreferredAgents(isGlobal);
    usedFallbackAgent = targetAgents.length === 1 && targetAgents[0]?.id === FALLBACK_AGENT_ID;

    if (usedFallbackAgent) {
      warn('No agent-specific directory detected. Installing to .agents.');
    }
  }

  const locationLabel = isGlobal ? 'global' : 'project';

  console.log();
  console.log(pc.bold(`Installing ${selectedEntries.length} skill(s) to ${targetAgents.length} agent(s):`));
  console.log();

  for (const entry of selectedEntries) {
    console.log(`  ${pc.green('•')} ${pc.bold(entry.skill.name)}`);
    console.log(`    ${pc.dim(entry.skill.description)}`);
    console.log(`    ${pc.dim(`Source: ${entry.updateStrategy === 'registry' ? 'registry' : 'github'}`)}`);
  }
  console.log();

  console.log(pc.dim('Target agents:'));
  for (const agent of targetAgents) {
    const path = getAgentBasePath(agent, isGlobal);
    console.log(`  ${pc.cyan('•')} ${agent.name} → ${pc.dim(path)}`);
  }
  console.log();

  if (!options.yes) {
    const confirm = await prompt(`Install to ${locationLabel} directory? [Y/n] `);
    if (confirm.toLowerCase() === 'n') {
      info('Installation cancelled.');
      process.exit(0);
    }
  }

  const prepareSpinner = spinner('Preparing skill files');
  try {
    await hydrateCompanionFilesForInstall(selectedEntries, githubSnapshot);
    prepareSpinner.stop(true);
  } catch (err) {
    prepareSpinner.stop(false);
    error(err instanceof Error ? err.message : 'Failed to prepare skill files');
    process.exit(1);
  }

  let installed = 0;
  let skipped = 0;
  let wroteGitDiscoveredSkill = false;

  for (const entry of selectedEntries) {
    const { skill } = entry;
    const activeAgentIds = new Set<string>();

    for (const agent of targetAgents) {
      const skillDir = getSkillPath(agent, skill.name, isGlobal);
      const skillFile = join(skillDir, 'SKILL.md');
      const existedBefore = existsSync(skillFile);

      if (existedBefore && !options.force) {
        const existingContent = readFileSync(skillFile, 'utf-8');
        if (
          existingContent === skill.content
          && companionFilesAreUpToDate(skillDir, skill, { skipValidation: entry.companionFilesHydrationFailed === true })
        ) {
          skipped++;
          activeAgentIds.add(agent.id);
          continue;
        }

        if (!options.yes) {
          warn(`${skill.name} already exists for ${agent.name}`);
          const overwrite = await prompt('Overwrite? [y/N] ');
          if (overwrite.toLowerCase() !== 'y') {
            skipped++;
            activeAgentIds.add(agent.id);
            continue;
          }
        }
      }

      try {
        mkdirSync(dirname(skillFile), { recursive: true });
        writeFileSync(skillFile, skill.content, 'utf-8');
        if (!entry.companionFilesHydrationFailed) {
          syncCompanionFiles(skillDir, skill);
        }
        installed++;
        activeAgentIds.add(agent.id);

        if (entry.updateStrategy === 'git') {
          wroteGitDiscoveredSkill = true;
        }

        if (entry.cacheOwner && entry.cacheRepo) {
          const cacheSkillPath = normalizeSkillPath(entry.cachePath ?? skill.path);
          cacheSkill(
            entry.cacheOwner,
            entry.cacheRepo,
            skill.content,
            entry.updateStrategy === 'registry' ? 'registry' : 'github',
            cacheSkillPath,
            skill.sha
          );
          verboseLog(`Cached skill: ${skill.name}`);
        }
      } catch (err) {
        if (existedBefore) {
          activeAgentIds.add(agent.id);
        }
        error(`Failed to install ${skill.name} to ${agent.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    if (activeAgentIds.size > 0) {
      recordInstallation({
        name: skill.name,
        description: skill.description,
        source: entry.installSource,
        registrySlug: entry.registrySlug,
        updateStrategy: entry.updateStrategy,
        agents: Array.from(activeAgentIds),
        global: isGlobal,
        installedAt: Date.now(),
        sha: skill.sha,
        path: skill.path,
        contentHash: skill.contentHash,
      });

      trackInstallation(entry.trackingSlug).catch(() => {});
    }
  }

  if (
    installed > 0 &&
    wroteGitDiscoveredSkill &&
    repoSource.platform === 'github' &&
    !isExplicitGitHubRefSource &&
    isDefaultRegistry()
  ) {
    submitRepoForIndexingInBackground(repoSource);
  }

  console.log();

  if (installed > 0) {
    success(`Installed ${installed} skill(s) successfully!`);
  }

  if (skipped > 0) {
    info(`Skipped ${skipped} skill(s) (already up to date)`);
  }

  console.log();
  console.log(pc.dim('Skills are now available in your coding agents.'));
  console.log(pc.dim('Restart your agent or start a new session to use them.'));
  if (usedFallbackAgent) {
    console.log(pc.dim('Need a tool-specific copy later? Run `npx skillscat convert <agent>` to copy from .agents.'));
  }
}

async function resolveInstallSkills({
  sourceInput,
  repoSource,
  requestedSkillNames,
  explicitRefBypassRegistry,
  githubSnapshot,
}: {
  sourceInput: string;
  repoSource: RepoSource;
  requestedSkillNames: string[];
  explicitRefBypassRegistry: boolean;
  githubSnapshot?: GitHubRepoSnapshot | null;
}): Promise<ResolveInstallSkillsResult> {
  const requestedNamesLower = new Set(requestedSkillNames.map((name) => name.toLowerCase()));
  const needsRegistryFirst = repoSource.platform === 'github' && !explicitRefBypassRegistry;
  const preferSlugLookup = isAmbiguousSlugOrRepoInput(sourceInput, repoSource);
  const canShortCircuitExactSlug = preferSlugLookup && requestedNamesLower.size === 0;

  let resolved: ResolvedInstallSkill[] = [];
  let selectionMode: ResolveSelectionMode = 'default';
  let registryRepoMatchesFound = false;
  let registrySummariesNeedingGitBackfill: RegistryRepoSkillSummary[] = [];

  if (canShortCircuitExactSlug) {
    const registrySlugSkill = await fetchSkill(sourceInput).catch((err) => {
      verboseLog(`Registry slug lookup failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    });

    if (registrySlugSkill?.content) {
      return {
        resolved: [toRegistryResolvedSkill(registrySlugSkill, sourceInput, repoSource)],
        selectionMode,
      };
    }
  }

  if (needsRegistryFirst) {
    try {
      const registryRepo = await fetchSkillsByRepo(repoSource.owner, repoSource.repo, {
        path: normalizeSkillPath(repoSource.path),
      });

      if (registryRepo.skills.length > 0) {
        registryRepoMatchesFound = true;

        let summaries = registryRepo.skills;
        if (repoSource.path) {
          const normalizedPath = normalizeSkillPath(repoSource.path);
          summaries = summaries.filter((item) => normalizeSkillPath(item.skillPath) === normalizedPath);
        }

        let selectedSummaries = summaries;
        if (requestedNamesLower.size > 0) {
          selectedSummaries = summaries.filter((item) => requestedNamesLower.has(item.name.toLowerCase()));
        } else if (preferSlugLookup) {
          selectionMode = 'install-all';
        }

        if (selectedSummaries.length > 0) {
          const registryFetch = await fetchRegistryResolvedSkills(selectedSummaries, sourceInput, repoSource);
          resolved.push(...registryFetch.resolved);
          registrySummariesNeedingGitBackfill = registryFetch.missingSummaries;
        }
      }
    } catch (err) {
      verboseLog(`Registry repo lookup failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  const missingRequestedNames = requestedSkillNames.filter((name) =>
    !resolved.some((entry) => entry.skill.name.toLowerCase() === name.toLowerCase())
  );

  const shouldRunGitDiscovery =
    explicitRefBypassRegistry ||
    repoSource.platform !== 'github' ||
    !registryRepoMatchesFound ||
    resolved.length === 0 ||
    missingRequestedNames.length > 0 ||
    registrySummariesNeedingGitBackfill.length > 0 ||
    (repoSource.path && resolved.length === 0);

  if (shouldRunGitDiscovery) {
    try {
      const gitSkills = await discoverSkills(repoSource, { githubSnapshot });
      let gitResolved = gitSkills.map((skill) => toGitResolvedSkill(skill, repoSource));

      if (missingRequestedNames.length > 0) {
        const missingLower = new Set(missingRequestedNames.map((name) => name.toLowerCase()));
        gitResolved = gitResolved.filter((entry) => missingLower.has(entry.skill.name.toLowerCase()));
      } else if (requestedNamesLower.size > 0 && resolved.length === 0) {
        gitResolved = gitResolved.filter((entry) => requestedNamesLower.has(entry.skill.name.toLowerCase()));
      } else if (registrySummariesNeedingGitBackfill.length > 0) {
        const backfillKeys = new Set(registrySummariesNeedingGitBackfill.map((summary) => getRegistrySummaryIdentityKey(summary)));
        gitResolved = gitResolved.filter((entry) => backfillKeys.has(getResolvedSkillIdentityKey(entry)));
      }

      resolved = mergeResolvedSkills(resolved, gitResolved);
    } catch (err) {
      if (explicitRefBypassRegistry) {
        throw err;
      }

      // Fallback: preserve existing behavior for registry slugs or private skills.
      if (resolved.length === 0 && !gitDiscoveryRanFailedDueToEmptyPath(err)) {
        const registrySkill = await fetchSkill(sourceInput).catch(() => null);
        if (registrySkill?.content) {
          resolved.push(toRegistryResolvedSkill(registrySkill, sourceInput, repoSource));
          return {
            resolved: mergeResolvedSkills([], resolved),
            selectionMode,
          };
        }
      }

      // If some registry skills were already resolved (partial hit), keep them.
      if (resolved.length > 0) {
        if (getMissingRequestedNames(requestedSkillNames, resolved).length > 0) {
          throw err;
        }
        return {
          resolved: mergeResolvedSkills([], resolved),
          selectionMode,
        };
      }

      throw err;
    }
  }

  if (requestedNamesLower.size > 0 && resolved.length > 0) {
    resolved = resolved.filter((entry) => requestedNamesLower.has(entry.skill.name.toLowerCase()));
  }

  return {
    resolved: mergeResolvedSkills([], resolved),
    selectionMode,
  };
}

async function fetchRegistryResolvedSkills(
  summaries: RegistryRepoSkillSummary[],
  sourceInput: string,
  repoSource: RepoSource
): Promise<{
  resolved: ResolvedInstallSkill[];
  missingSummaries: RegistryRepoSkillSummary[];
}> {
  const resolved: ResolvedInstallSkill[] = [];
  const missingSummaries: RegistryRepoSkillSummary[] = [];

  for (const summary of summaries) {
    if (!summary.slug) continue;
    try {
      const full = await fetchSkill(summary.slug);
      if (!full?.content) {
        missingSummaries.push(summary);
        continue;
      }
      resolved.push(toRegistryResolvedSkill(full, sourceInput, repoSource));
    } catch (err) {
      verboseLog(`Failed to fetch registry skill ${summary.slug}: ${err instanceof Error ? err.message : 'unknown'}`);
      missingSummaries.push(summary);
    }
  }

  return {
    resolved,
    missingSummaries,
  };
}

function mergeResolvedSkills(existing: ResolvedInstallSkill[], incoming: ResolvedInstallSkill[]): ResolvedInstallSkill[] {
  const merged = [...existing];
  const seen = new Set(existing.map((entry) => getResolvedSkillIdentityKey(entry)));

  for (const entry of incoming) {
    const key = getResolvedSkillIdentityKey(entry);
    if (seen.has(key)) {
      continue;
    }
    merged.push(entry);
    seen.add(key);
  }

  return merged;
}

function getResolvedSkillIdentityKey(entry: ResolvedInstallSkill): string {
  const normalizedPath = normalizeSkillPath(entry.skill.path);
  if (normalizedPath) return `path:${normalizedPath.toLowerCase()}`;
  return `name:${entry.skill.name.toLowerCase()}`;
}

function getRegistrySummaryIdentityKey(summary: RegistryRepoSkillSummary): string {
  const normalizedPath = normalizeSkillPath(summary.skillPath);
  if (normalizedPath) return `path:${normalizedPath.toLowerCase()}`;
  return `name:${summary.name.toLowerCase()}`;
}

function toGitResolvedSkill(skill: SkillInfo, repoSource: RepoSource): ResolvedInstallSkill {
  return {
    skill,
    installSource: repoSource,
    updateStrategy: 'git',
    trackingSlug: `${repoSource.owner}/${repoSource.repo}`,
    cacheOwner: repoSource.owner,
    cacheRepo: repoSource.repo,
    cachePath: normalizeSkillPath(skill.path) || normalizeSkillPath(repoSource.path),
  };
}

function toRegistryResolvedSkill(skill: SkillRegistryItem, fallbackInput: string, fallbackSource: RepoSource): ResolvedInstallSkill {
  const parsedGitSource = getSourceFromRegistrySkill(skill) ?? fallbackSource;
  const registrySlug = getRegistrySlug(skill, fallbackInput);
  const normalizedSkillPath = normalizeSkillPath(skill.skillPath);
  const skillPath = toSkillFilePath(normalizedSkillPath);

  return {
    skill: {
      name: skill.name,
      description: skill.description || '',
      path: skillPath,
      content: skill.content,
      contentHash: skill.contentHash,
    },
    installSource: parsedGitSource,
    registrySlug,
    updateStrategy: 'registry',
    trackingSlug: registrySlug,
    cacheOwner: parsedGitSource?.owner || skill.owner,
    cacheRepo: parsedGitSource?.repo || skill.repo,
    cachePath: normalizeSkillPath(parsedGitSource?.path) || normalizedSkillPath,
  };
}

async function selectSingleSkillInteractive(entries: ResolvedInstallSkill[]): Promise<ResolvedInstallSkill> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    error('Multiple skills found but no interactive terminal is available.');
    console.log(pc.dim('Use `--yes` to install all skills, or `-s <name>` to choose a specific skill.'));
    process.exit(1);
  }

  const inquirer = await import('inquirer');
  const answer = await inquirer.default.prompt<{ skillKey: string }>([
    {
      type: 'list',
      name: 'skillKey',
      message: 'Multiple skills found. Select one to install:',
      choices: entries.map((entry, index) => ({
        name: `${entry.skill.name}  ${pc.dim(`(${entry.skill.path})`)}${entry.skill.description ? ` - ${entry.skill.description}` : ''}`,
        value: String(index),
      })),
    },
  ]);

  const selected = entries[Number.parseInt(answer.skillKey, 10)];
  if (!selected) {
    error('No skill selected.');
    process.exit(1);
  }
  return selected;
}

async function hydrateCompanionFilesForInstall(
  entries: ResolvedInstallSkill[],
  githubSnapshot?: GitHubRepoSnapshot | null
): Promise<void> {
  for (const entry of entries) {
    if (entry.skill.companionFiles) continue;

    const installSource = entry.installSource;
    if (!installSource || installSource.platform !== 'github') {
      continue;
    }

    try {
      entry.skill.companionFiles = await fetchSkillCompanionFilesWithOptions(
        installSource,
        entry.skill.path,
        { githubSnapshot }
      );
      entry.companionFilesHydrationFailed = false;
    } catch (err) {
      verboseLog(`Failed to fetch companion files for ${entry.skill.name}: ${err instanceof Error ? err.message : 'unknown'}`);
      entry.companionFilesHydrationFailed = true;
    }
  }
}

function companionFilesAreUpToDate(
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

  for (const file of skill.companionFiles ?? []) {
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
    } catch {
      return false;
    }
  }

  return true;
}

function syncCompanionFiles(skillDir: string, skill: SkillInfo): void {
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
    } catch {
      // Best-effort cleanup only; write phase below still proceeds.
    }
  }

  for (const file of expectedFiles) {
    const destination = join(skillDir, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(file.content));
  }

  writeCompanionManifest(skillDir, expectedPaths);
}

function getExpectedCompanionFiles(skill: SkillInfo): Array<{ path: string; content: Uint8Array }> {
  const files = skill.companionFiles ?? [];
  const deduped = new Map<string, Uint8Array>();

  for (const file of files) {
    const normalized = normalizeCompanionRelativePath(file.path);
    if (!normalized) continue;
    deduped.set(normalized, file.content);
  }

  return Array.from(deduped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, content]) => ({ path, content }));
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
      .filter((value): value is string => Boolean(value));

    validFiles.sort((a, b) => a.localeCompare(b));
    return Array.from(new Set(validFiles));
  } catch {
    return null;
  }
}

function writeCompanionManifest(skillDir: string, files: string[]): void {
  const manifestPath = join(skillDir, COMPANION_MANIFEST_FILE);
  const normalizedFiles = Array.from(new Set(files.map(normalizeCompanionRelativePath).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b));

  if (normalizedFiles.length === 0) {
    try {
      rmSync(manifestPath, { force: true });
    } catch {
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

function normalizeCompanionRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return '';
  }
  if (segments.includes(COMPANION_MANIFEST_FILE)) {
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
      rmSync(current, { recursive: false, force: true });
    } catch {
      break;
    }
    current = dirname(current);
  }
}

function sameStringArrays(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeSkillPath(path?: string): string {
  if (!path) return '';
  const normalized = path.replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  return normalized.replace(/(?:^|\/)SKILL\.md$/i, '');
}

function formatSkillPathHint(path?: string): string {
  const normalized = normalizeSkillPath(path);
  return normalized ? ` (${normalized})` : '';
}

function toSkillFilePath(path?: string): string {
  const normalized = normalizeSkillPath(path);
  return normalized ? `${normalized}/SKILL.md` : 'SKILL.md';
}

function isAmbiguousSlugOrRepoInput(sourceInput: string, repoSource: RepoSource): boolean {
  return (
    repoSource.platform === 'github'
    && !repoSource.path
    && !repoSource.branch
    && repoSource.hasExplicitRef !== true
    && sourceInput.trim() === `${repoSource.owner}/${repoSource.repo}`
  );
}

function gitDiscoveryRanFailedDueToEmptyPath(_err: unknown): boolean {
  // Placeholder for future error-specific handling; currently unused but keeps fallback intent explicit.
  return false;
}

function getSourceFromRegistrySkill(skill: SkillRegistryItem): RepoSource | null {
  if (skill.githubUrl) {
    const source = parseSource(skill.githubUrl);
    if (source) {
      return source;
    }
  }

  if (skill.owner && skill.repo) {
    return {
      platform: 'github',
      owner: skill.owner,
      repo: skill.repo,
      path: normalizeSkillPath(skill.skillPath) || undefined,
    };
  }

  return null;
}

function getRegistrySlug(skill: SkillRegistryItem, fallback: string): string {
  if (skill.slug && skill.slug.includes('/')) {
    return skill.slug;
  }
  if (skill.owner && skill.repo) {
    return `${skill.owner}/${skill.repo}`;
  }
  const parsedFallback = parseSource(fallback);
  if (parsedFallback) {
    return `${parsedFallback.owner}/${parsedFallback.repo}`;
  }
  return fallback;
}

function getMissingRequestedNames(requestedSkillNames: string[], resolved: ResolvedInstallSkill[]): string[] {
  if (requestedSkillNames.length === 0) return [];

  const foundNames = new Set(resolved.map((entry) => entry.skill.name.toLowerCase()));
  const missing: string[] = [];
  const seenMissing = new Set<string>();

  for (const requested of requestedSkillNames) {
    const key = requested.toLowerCase();
    if (foundNames.has(key) || seenMissing.has(key)) {
      continue;
    }
    seenMissing.add(key);
    missing.push(requested);
  }

  return missing;
}
