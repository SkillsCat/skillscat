import pc from 'picocolors';
import { isAuthenticated, getUser, getToken } from '../utils/auth.js';
import { getRegistryUrl } from '../utils/config.js';

export async function whoami(): Promise<void> {
  if (!isAuthenticated()) {
    console.log(pc.yellow('Not logged in.'));
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    return;
  }

  const user = getUser();
  const token = getToken();

  // Try to get fresh user info from API
  try {
    const response = await fetch(`${getRegistryUrl().replace('/registry', '')}/api/tokens`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      console.log(pc.green('Logged in'));
      if (user?.name) {
        console.log(`  Username: ${pc.cyan(user.name)}`);
      }
      if (user?.email) {
        console.log(`  Email: ${pc.dim(user.email)}`);
      }
      console.log(`  Token: ${pc.dim(token?.slice(0, 11) + '...')}`);
    } else {
      console.log(pc.yellow('Token may be invalid or expired.'));
      console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
    }
  } catch {
    // Offline mode - show cached info
    console.log(pc.green('Logged in (offline)'));
    if (user?.name) {
      console.log(`  Username: ${pc.cyan(user.name)}`);
    }
    console.log(`  Token: ${pc.dim(token?.slice(0, 11) + '...')}`);
  }
}
