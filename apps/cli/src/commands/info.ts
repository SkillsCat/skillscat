import pc from 'picocolors';
import { parseSource } from '../utils/source/source';
import { discoverSkills } from '../utils/source/git';
import { AGENTS } from '../utils/agents/agents';
import { dataTable, details, error, hint, spinner, warn } from '../utils/core/ui';

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

  const fields: Array<[string, string]> = [['Platform', repoSource.platform], ['Owner', repoSource.owner], ['Repository', repoSource.repo]];
  if (repoSource.branch) fields.push(['Branch', repoSource.branch]);
  if (repoSource.path) fields.push(['Path', repoSource.path]);
  details(sourceLabel, fields);

  if (skills.length === 0) {
    warn('No skills found in this repository.');
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

  dataTable(`Skills (${skills.length}):`, ['#', 'Skill', 'Path', 'Description'],
    skills.map((skill, i) => [String(i + 1), skill.name, skill.path || '.', skill.description]));
  hint('Install published skills by slug:', 'npx skillscat add <slug>');
  hint('Use search or the web detail page to discover the exact published slug for this repository.');

  // Show compatible agents
  details('Compatible agents', [['Agents', AGENTS.map(a => a.name).join(', ')]]);
}
