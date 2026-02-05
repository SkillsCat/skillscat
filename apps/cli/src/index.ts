#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { add } from './commands/add';
import { list } from './commands/list';
import { search } from './commands/search';
import { remove } from './commands/remove';
import { update } from './commands/update';
import { info } from './commands/info';
import { login } from './commands/login';
import { logout } from './commands/logout';
import { whoami } from './commands/whoami';
import { publish } from './commands/publish';
import { submit } from './commands/submit';
import { deleteSkill } from './commands/delete';
import { configSet, configGet, configList, configDelete } from './commands/config';
import { setVerbose } from './utils/core/verbose';

const program = new Command();

program
  .name('skillscat')
  .description('CLI for installing agent skills from GitHub repositories')
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerbose(true);
    }
  });

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

// Login command
program
  .command('login')
  .description('Authenticate with SkillsCat')
  .option('-t, --token <token>', 'Use an API token directly')
  .action(login);

// Logout command
program
  .command('logout')
  .description('Sign out from SkillsCat')
  .action(logout);

// Whoami command
program
  .command('whoami')
  .description('Show current authenticated user')
  .action(whoami);

// Publish command
program
  .command('publish <path>')
  .description('Publish a skill to SkillsCat')
  .option('-n, --name <name>', 'Skill name')
  .option('-o, --org <org>', 'Publish under an organization')
  .option('-p, --private', 'Force private visibility (default: public if org connected to GitHub)')
  .option('-d, --description <desc>', 'Skill description')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(publish);

// Submit command
program
  .command('submit [url]')
  .description('Submit a GitHub repository to SkillsCat registry')
  .action(submit);

// Delete command
program
  .command('delete <slug>')
  .description('Delete a private skill from SkillsCat')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(deleteSkill);

// Config command with subcommands
const configCommand = program
  .command('config')
  .description('Manage CLI configuration');

configCommand
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(configSet);

configCommand
  .command('get <key>')
  .description('Get a configuration value')
  .action(configGet);

configCommand
  .command('list')
  .description('List all configuration values')
  .action(configList);

configCommand
  .command('delete <key>')
  .alias('rm')
  .description('Delete a configuration value (reset to default)')
  .action(configDelete);

// Error handling
program.exitOverride((err) => {
  if (err.code === 'commander.help') {
    process.exit(0);
  }
  console.error(pc.red(`Error: ${err.message}`));
  process.exit(1);
});

program.parse();
