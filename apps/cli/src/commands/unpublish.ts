import { error as showError, info as showInfo, success as showSuccess, cancelled, details, warn } from '../utils/core/ui';
import pc from 'picocolors';
import { getValidToken, getBaseUrl } from '../utils/auth/auth';
import { fetchWithTimeout } from '../utils/core/fetch';
import { confirmText } from '../utils/core/prompts';
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
    showError('Authentication required or session expired.');
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    process.exit(1);
  }

  try {
    parseSlug(slug);
  } catch {
    showError('Invalid slug format. Expected format: owner/skill-name');
    process.exit(1);
  }

  if (!options.yes) {
    details('Unpublish skill', [['Slug', slug]]);

    warn('This action cannot be undone!');
    console.log();
    if (!await confirmText(`Unpublish ${slug}?`, slug)) {
      cancelled();
      process.exit(0);
    }
    console.log();
  }

  showInfo('Unpublishing skill...');

  const latestToken = await getValidToken();
  if (!latestToken) {
    showError('Session expired. Please run `skillscat login` and try again.');
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
      showError(`Failed to unpublish: ${result.error || result.message || 'Unknown error'}`);
      process.exit(1);
    }

    showSuccess('Skill unpublished successfully!');
  } catch (requestError) {
    showError('Failed to connect to registry.');
    if (requestError instanceof Error) {
      console.error(pc.dim(requestError.message));
    }
    process.exit(1);
  }
}
