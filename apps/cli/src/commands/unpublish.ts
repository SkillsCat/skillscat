import pc from 'picocolors';
import { isAuthenticated, getValidToken, getBaseUrl } from '../utils/auth/auth';
import { prompt, warn } from '../utils/core/ui';
import { parseSlug } from '../utils/core/slug';

interface UnpublishOptions {
  yes?: boolean;  // Skip confirmation
}

interface SkillInfo {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
}

interface UnpublishResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Find skill by slug using two-segment path
 */
async function findSkillBySlug(slug: string): Promise<SkillInfo | null> {
  const token = await getValidToken();
  const { owner, name } = parseSlug(slug);
  const response = await fetch(
    `${getBaseUrl()}/api/skills/${owner}/${name}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'skillscat-cli/0.1.0',
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { success: boolean; data?: { skill?: SkillInfo } };
  return data.data?.skill || null;
}

export async function unpublishSkill(slug: string, options: UnpublishOptions): Promise<void> {
  // Check authentication
  if (!isAuthenticated()) {
    console.error(pc.red('Authentication required.'));
    console.log(pc.dim('Run `skillscat login` first.'));
    process.exit(1);
  }

  // Validate slug format
  if (!slug.includes('/')) {
    console.error(pc.red('Invalid slug format. Expected format: owner/skill-name'));
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
      console.error(pc.red('Cannot unpublish GitHub-sourced skills.'));
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
      const answer = await prompt(`Unpublish ${pc.red(slug)}? Type the slug to confirm: `);
      if (answer !== slug) {
        console.log(pc.dim('Cancelled.'));
        process.exit(0);
      }
      console.log();
    }

    // Unpublish the skill using two-segment path
    console.log(pc.cyan('Unpublishing skill...'));

    const token = await getValidToken();
    const baseUrl = getBaseUrl();
    const { owner, name } = parseSlug(slug);
    const response = await fetch(
      `${baseUrl}/api/skills/${owner}/${name}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'skillscat-cli/0.1.0',
          'Origin': baseUrl,
        },
      }
    );

    const result = await response.json() as UnpublishResponse;

    if (!response.ok || !result.success) {
      console.error(pc.red(`Failed to unpublish: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    console.log(pc.green('✔ Skill unpublished successfully!'));
  } catch (error) {
    console.error(pc.red('Failed to connect to registry.'));
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    process.exit(1);
  }
}
