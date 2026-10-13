import { success as showSuccess, warn as showWarning, details } from '../utils/core/ui';
import pc from 'picocolors';
import { isAuthenticated, getPrincipal, getValidToken, validateAccessToken } from '../utils/auth/auth';

export async function whoami(): Promise<void> {
  if (!isAuthenticated()) {
    showWarning('Not logged in.');
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    process.exit(1);
  }

  const cachedPrincipal = getPrincipal();
  const token = await getValidToken();
  if (!token) {
    showWarning('Token expired.');
    console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
    process.exit(1);
  }

  const principal = await validateAccessToken(token);
  if (principal) {
    showSuccess('Logged in');
    const displayName = principal.name || cachedPrincipal?.name;
    const fields: Array<[string, string]> = [];
    if (principal.type === 'org') {
      fields.push(['Organization', displayName || principal.slug || principal.id]);
      if (principal.slug) {
        fields.push(['Slug', principal.slug]);
      }
    } else if (displayName) {
      fields.push(['Username', displayName]);
    }
    if (principal.email) {
      fields.push(['Email', principal.email]);
    } else if (cachedPrincipal?.email) {
      fields.push(['Email', cachedPrincipal.email]);
    }
    fields.push(['Token', token.slice(0, 11) + '...']);
    details('Account', fields);
    return;
  }

  showWarning('Token may be invalid or expired.');
  console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
  process.exit(1);
}
