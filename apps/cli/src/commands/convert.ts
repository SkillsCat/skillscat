import { basename, dirname, join } from 'node:path';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import pc from 'picocolors';
import { copyInstallationAgent } from '../utils/storage/db';
import { error, info, success, warn } from '../utils/core/ui';
import { FALLBACK_AGENT_ID, getAgentBasePath, getAgentById } from '../utils/agents/agents';

interface ConvertOptions {
  from?: string;
  global?: boolean;
  force?: boolean;
}

function getSkillDirectories(basePath: string): string[] {
  if (!existsSync(basePath)) {
    return [];
  }

  return readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(basePath, entry.name))
    .filter((skillDir) => existsSync(join(skillDir, 'SKILL.md')));
}

export async function convert(targetAgentId: string, options: ConvertOptions): Promise<void> {
  const isGlobal = options.global ?? false;
  const sourceAgent = getAgentById(options.from ?? FALLBACK_AGENT_ID);
  const targetAgent = getAgentById(targetAgentId);

  if (!sourceAgent) {
    error(`Invalid source agent: ${options.from ?? FALLBACK_AGENT_ID}`);
    process.exit(1);
  }

  if (!targetAgent) {
    error(`Invalid target agent: ${targetAgentId}`);
    process.exit(1);
  }

  const sourceBase = getAgentBasePath(sourceAgent, isGlobal);
  const targetBase = getAgentBasePath(targetAgent, isGlobal);

  if (sourceBase === targetBase) {
    error('Source and target directories are the same.');
    process.exit(1);
  }

  const sourceSkills = getSkillDirectories(sourceBase);
  if (sourceSkills.length === 0) {
    warn(`No skills found in ${sourceAgent.name}.`);
    console.log(pc.dim(`Checked: ${sourceBase}`));
    return;
  }

  let copied = 0;
  let skipped = 0;
  const copiedSkillDirs: string[] = [];

  for (const sourceSkillDir of sourceSkills) {
    const skillName = basename(sourceSkillDir);
    const targetSkillDir = join(targetBase, skillName);

    if (existsSync(targetSkillDir)) {
      if (!options.force) {
        skipped += 1;
        continue;
      }
      rmSync(targetSkillDir, { recursive: true, force: true });
    }

    mkdirSync(dirname(targetSkillDir), { recursive: true });
    cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
    copied += 1;
    copiedSkillDirs.push(sourceSkillDir);
  }

  if (copied === 0) {
    warn(`All ${sourceSkills.length} skill(s) already exist in ${targetAgent.name}.`);
    console.log(pc.dim('Use `--force` to overwrite the target copy.'));
    return;
  }

  const trackedUpdates = copyInstallationAgent(sourceAgent.id, targetAgent.id, {
    global: isGlobal,
    installRoot: isGlobal ? undefined : process.cwd(),
    sourceSkillDirs: copiedSkillDirs,
  });

  console.log();
  success(`Copied ${copied} skill(s) from ${sourceAgent.name} to ${targetAgent.name}.`);
  console.log(pc.dim(`${sourceBase} → ${targetBase}`));

  if (skipped > 0) {
    info(`Skipped ${skipped} existing skill(s). Use --force to overwrite them.`);
  }

  if (trackedUpdates > 0) {
    console.log(pc.dim(`Updated ${trackedUpdates} tracked installation(s) so future updates also target ${targetAgent.name}.`));
  }
}
