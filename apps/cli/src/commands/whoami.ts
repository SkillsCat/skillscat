import pc from 'picocolors';
import { isAuthenticated, getPrincipal, getValidToken, validateAccessToken } from '../utils/auth/auth';

export async function whoami(): Promise<void> {
  if (!isAuthenticated()) {
    console.log(pc.yellow('Not logged in.'));
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    process.exit(1);
  }

  const cachedPrincipal = getPrincipal();
  const token = await getValidToken();
  if (!token) {
    console.log(pc.yellow('Token expired.'));
    console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
    process.exit(1);
  }

  const principal = await validateAccessToken(token);
  if (principal) {
    console.log(pc.green('Logged in'));
    const displayName = principal.name || cachedPrincipal?.name;
    if (principal.type === 'org') {
      console.log(`  Organization: ${pc.cyan(displayName || principal.slug || principal.id)}`);
      if (principal.slug) {
        console.log(`  Slug: ${pc.cyan(principal.slug)}`);
      }
    } else if (displayName) {
      console.log(`  Username: ${pc.cyan(displayName)}`);
    }
    if (principal.email) {
      console.log(`  Email: ${pc.dim(principal.email)}`);
    } else if (cachedPrincipal?.email) {
      console.log(`  Email: ${pc.dim(cachedPrincipal.email)}`);
    }
    console.log(`  Token: ${pc.dim(token.slice(0, 11) + '...')}`);
    return;
  }

  console.log(pc.yellow('Token may be invalid or expired.'));
  console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
  process.exit(1);
}
