import pc from 'picocolors';
import { parseSource } from '../utils/source/source';
import { discoverSkills } from '../utils/source/git';
import { AGENTS } from '../utils/agents/agents';
import { error, spinner } from '../utils/core/ui';

export async function info(source: string): Promise<void> {
  // Parse source
  const repoSource = parseSource(source);
  if (!repoSource) {
    error('Invalid source. Supported formats:');
    console.log(pc.dim('  owner/repo'));
    console.log(pc.dim('  https://github.com/owner/repo'));
    console.log(pc.dim('  https://gitlab.com/owner/repo'));
    process.exit(1);
  }

  const sourceLabel = `${repoSource.owner}/${repoSource.repo}`;
  const infoSpinner = spinner(`Fetching info for ${sourceLabel}`);

  let skills;
  try {
    skills = await discoverSkills(repoSource);
  } catch (err) {
    infoSpinner.stop(false);
    error(err instanceof Error ? err.message : 'Failed to fetch repository info');
    process.exit(1);
  }

  infoSpinner.stop(true);

  console.log();
  console.log(pc.bold(pc.cyan(sourceLabel)));
  console.log();

  // Repository info
  console.log(pc.dim('Platform:     ') + repoSource.platform);
  console.log(pc.dim('Owner:        ') + repoSource.owner);
  console.log(pc.dim('Repository:   ') + repoSource.repo);
  if (repoSource.branch) {
    console.log(pc.dim('Branch:       ') + repoSource.branch);
  }
  if (repoSource.path) {
    console.log(pc.dim('Path:         ') + repoSource.path);
  }

  console.log();
  console.log(pc.dim('─'.repeat(50)));
  console.log();

  if (skills.length === 0) {
    console.log(pc.yellow('No skills found in this repository.'));
    console.log();
    console.log(pc.dim('To create a skill, add a SKILL.md file with:'));
    console.log(pc.dim(''));
    console.log(pc.dim('  ---'));
    console.log(pc.dim('  name: my-skill'));
    console.log(pc.dim('  description: What this skill does'));
    console.log(pc.dim('  ---'));
    console.log(pc.dim(''));
    console.log(pc.dim('  # My Skill'));
    console.log(pc.dim('  Instructions for the agent...'));
    return;
  }

  console.log(pc.bold(`Skills (${skills.length}):`));
  console.log();

  for (const skill of skills) {
    console.log(`  ${pc.green('•')} ${pc.bold(skill.name)}`);
    console.log(`    ${pc.dim(skill.description)}`);
    console.log(`    ${pc.dim(`Path: ${skill.path}`)}`);
    console.log();
  }

  console.log(pc.dim('─'.repeat(50)));
  console.log();
  console.log(pc.bold('Install:'));
  console.log(`  ${pc.cyan(`npx skillscat add ${source}`)}`);
  console.log();

  // Show compatible agents
  console.log(pc.bold('Compatible agents:'));
  console.log(`  ${AGENTS.map(a => a.name).join(', ')}`);
}
