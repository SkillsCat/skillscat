import pc from 'picocolors';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { isAuthenticated, getToken } from '../utils/auth.js';
import { REGISTRY_URL } from '../utils/paths.js';

interface PublishOptions {
  name?: string;
  org?: string;
  public?: boolean;
  description?: string;
}

export async function publish(skillPath: string, options: PublishOptions): Promise<void> {
  // Check authentication
  if (!isAuthenticated()) {
    console.error(pc.red('Authentication required.'));
    console.log(pc.dim('Run `skillscat login` first.'));
    process.exit(1);
  }

  // Resolve skill path
  const resolvedPath = resolve(skillPath);
  let skillMdPath = resolvedPath;

  // If path is a directory, look for SKILL.md
  if (existsSync(resolvedPath) && !resolvedPath.endsWith('.md')) {
    skillMdPath = resolve(resolvedPath, 'SKILL.md');
  }

  if (!existsSync(skillMdPath)) {
    console.error(pc.red(`SKILL.md not found at ${skillMdPath}`));
    process.exit(1);
  }

  // Read SKILL.md content
  const content = readFileSync(skillMdPath, 'utf-8');

  // Extract name from content if not provided
  let skillName = options.name;
  if (!skillName) {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      skillName = titleMatch[1].trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  }

  if (!skillName) {
    console.error(pc.red('Could not determine skill name. Use --name to specify.'));
    process.exit(1);
  }

  console.log(pc.cyan(`Publishing skill: ${skillName}`));

  // Prepare form data
  const formData = new FormData();
  formData.append('skill_md', new Blob([content], { type: 'text/markdown' }), 'SKILL.md');
  formData.append('name', skillName);
  formData.append('visibility', options.public ? 'public' : 'private');

  if (options.org) {
    formData.append('org', options.org);
  }

  if (options.description) {
    formData.append('description', options.description);
  }

  try {
    const response = await fetch(`${REGISTRY_URL.replace('/api/registry', '')}/api/skills/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
      body: formData,
    });

    const result = await response.json() as {
      success: boolean;
      slug?: string;
      message?: string;
      error?: string;
    };

    if (!response.ok || !result.success) {
      console.error(pc.red(`Failed to publish: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    console.log(pc.green('Skill published successfully!'));
    console.log();
    console.log(`  Slug: ${pc.cyan(result.slug)}`);
    console.log(`  Visibility: ${pc.dim(options.public ? 'public' : 'private')}`);
    console.log();
    console.log(pc.dim('To install this skill:'));
    console.log(pc.cyan(`  skillscat add ${result.slug}`));
  } catch (error) {
    console.error(pc.red('Failed to connect to registry.'));
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    process.exit(1);
  }
}
