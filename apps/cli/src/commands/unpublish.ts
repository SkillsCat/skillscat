import pc from 'picocolors';
import { getValidToken, getBaseUrl } from '../utils/auth/auth';
import { fetchWithTimeout } from '../utils/core/fetch';
import { prompt, warn } from '../utils/core/ui';
import { encodeSlugForSkillPath, parseSlug } from '../utils/core/slug';

interface UnpublishOptions {
  yes?: boolean;  // Skip confirmation
}

interface UnpublishResponse {
  success: boolean;
  message?: string;
  error?: string;
}

async function readResponsePayload<T>(response: Response): Promise<Partial<T>> {
  try {
    return await response.json() as Partial<T>;
  } catch {
    return {};
  }
}

export async function unpublishSkill(slug: string, options: UnpublishOptions): Promise<void> {
  // Check authentication/session validity.
  const token = await getValidToken();
  if (!token) {
    console.error(pc.red('Authentication required or session expired.'));
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    process.exit(1);
  }

  try {
    parseSlug(slug);
  } catch {
    console.error(pc.red('Invalid slug format. Expected format: owner/skill-name'));
    process.exit(1);
  }

  if (!options.yes) {
    console.log(`Slug: ${pc.cyan(slug)}`);
    console.log();

    warn('This action cannot be undone!');
    console.log();
    const answer = await prompt(`Unpublish ${pc.red(slug)}? Type the slug to confirm: `);
    if (answer !== slug) {
      console.log(pc.dim('Cancelled.'));
      process.exit(0);
    }
    console.log();
  }

  console.log(pc.cyan('Unpublishing skill...'));

  const latestToken = await getValidToken();
  if (!latestToken) {
    console.error(pc.red('Session expired. Please run `skillscat login` and try again.'));
    process.exit(1);
  }
  const baseUrl = getBaseUrl();

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/skills/${encodeSlugForSkillPath(slug)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${latestToken}`,
          'User-Agent': 'skillscat-cli/0.1.0',
          'Origin': baseUrl,
        },
      }
    );

    const result = await readResponsePayload<UnpublishResponse>(response);

    if (!response.ok || !result.success) {
      console.error(pc.red(`Failed to unpublish: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    console.log(pc.green('✔ Skill unpublished successfully!'));
  } catch (requestError) {
    console.error(pc.red('Failed to connect to registry.'));
    if (requestError instanceof Error) {
      console.error(pc.dim(requestError.message));
    }
    process.exit(1);
  }
}
