import pc from 'picocolors';
import { isAuthenticated, getToken } from '../utils/auth.js';
import { REGISTRY_URL } from '../utils/paths.js';
import { prompt, warn } from '../utils/ui.js';

interface DeleteOptions {
  yes?: boolean;  // Skip confirmation
}

interface SkillInfo {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
}

interface DeleteResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Find skill by slug
 */
async function findSkillBySlug(slug: string): Promise<SkillInfo | null> {
  const response = await fetch(
    `${REGISTRY_URL.replace('/api/registry', '')}/api/skills/${encodeURIComponent(slug)}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { success: boolean; data?: { skill?: SkillInfo } };
  return data.data?.skill || null;
}

export async function deleteSkill(slug: string, options: DeleteOptions): Promise<void> {
  // Check authentication
  if (!isAuthenticated()) {
    console.error(pc.red('Authentication required.'));
    console.log(pc.dim('Run `skillscat login` first.'));
    process.exit(1);
  }

  // Validate slug format
  if (!slug.startsWith('@')) {
    console.error(pc.red('Invalid slug format. Expected format: @username/skill-name'));
    process.exit(1);
  }

  console.log(pc.cyan('Looking up skill...'));

  try {
    // Find the skill first
    const skill = await findSkillBySlug(slug);

    if (!skill) {
      console.error(pc.red(`Skill not found: ${slug}`));
      process.exit(1);
    }

    // Check if it's a private (uploaded) skill
    if (skill.sourceType !== 'upload') {
      console.error(pc.red('Cannot delete GitHub-sourced skills.'));
      console.log(pc.dim('Remove the SKILL.md from your repository instead.'));
      process.exit(1);
    }

    console.log();
    console.log(`Skill: ${pc.cyan(skill.name)}`);
    console.log(`Slug: ${pc.cyan(skill.slug)}`);
    console.log();

    // Confirm unless --yes flag is provided
    if (!options.yes) {
      warn('This action cannot be undone!');
      console.log();
      const answer = await prompt(`Delete ${pc.red(slug)}? Type the slug to confirm: `);
      if (answer !== slug) {
        console.log(pc.dim('Cancelled.'));
        process.exit(0);
      }
      console.log();
    }

    // Delete the skill using slug
    console.log(pc.cyan('Deleting skill...'));

    const response = await fetch(
      `${REGISTRY_URL.replace('/api/registry', '')}/api/skills/${encodeURIComponent(slug)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
        },
      }
    );

    const result = await response.json() as DeleteResponse;

    if (!response.ok || !result.success) {
      console.error(pc.red(`Failed to delete: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    console.log(pc.green('✔ Skill deleted successfully!'));
  } catch (error) {
    console.error(pc.red('Failed to connect to registry.'));
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    process.exit(1);
  }
}
