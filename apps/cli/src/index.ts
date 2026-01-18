#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { add } from './commands/add.js';
import { list } from './commands/list.js';
import { search } from './commands/search.js';
import { remove } from './commands/remove.js';
import { update } from './commands/update.js';
import { info } from './commands/info.js';

const program = new Command();

program
  .name('skillscat')
  .description('CLI for installing agent skills from GitHub/GitLab repositories')
  .version('0.1.0');

// Main add command (compatible with add-skill)
program
  .command('add <source>')
  .alias('a')
  .alias('install')
  .alias('i')
  .description('Add a skill from a repository')
  .option('-g, --global', 'Install to user directory instead of project')
  .option('-a, --agent <agents...>', 'Target specific agents (e.g., claude-code, cursor)')
  .option('-s, --skill <skills...>', 'Install specific skills by name')
  .option('-l, --list', 'List available skills without installing')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('-f, --force', 'Overwrite existing skills')
  .action(add);

// Remove command
program
  .command('remove <skill>')
  .alias('rm')
  .alias('uninstall')
  .description('Remove an installed skill')
  .option('-g, --global', 'Remove from user directory')
  .option('-a, --agent <agents...>', 'Remove from specific agents')
  .action(remove);

// List command
program
  .command('list')
  .alias('ls')
  .description('List installed skills')
  .option('-g, --global', 'List skills from user directory')
  .option('-a, --agent <agents...>', 'List skills for specific agents')
  .option('--all', 'List all skills (project + global)')
  .action(list);

// Update command
program
  .command('update [skill]')
  .alias('upgrade')
  .description('Update installed skills')
  .option('-a, --agent <agents...>', 'Update for specific agents')
  .option('--check', 'Check for updates without installing')
  .action(update);

// Search command (uses SkillsCat registry)
program
  .command('search [query]')
  .alias('find')
  .description('Search skills in the SkillsCat registry')
  .option('-c, --category <category>', 'Filter by category')
  .option('-l, --limit <number>', 'Limit results', '20')
  .action(search);

// Info command
program
  .command('info <source>')
  .description('Show detailed information about a skill or repository')
  .action(info);

// Error handling
program.exitOverride((err) => {
  if (err.code === 'commander.help') {
    process.exit(0);
  }
  console.error(pc.red(`Error: ${err.message}`));
  process.exit(1);
});

program.parse();
