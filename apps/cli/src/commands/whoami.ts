import pc from 'picocolors';
import { isAuthenticated, getUser, getValidToken, validateAccessToken } from '../utils/auth/auth';

export async function whoami(): Promise<void> {
  if (!isAuthenticated()) {
    console.log(pc.yellow('Not logged in.'));
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    return;
  }

  const cachedUser = getUser();
  const token = await getValidToken();
  if (!token) {
    console.log(pc.yellow('Token expired.'));
    console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
    return;
  }

  const user = await validateAccessToken(token);
  if (user) {
    console.log(pc.green('Logged in'));
    if (user.name) {
      console.log(`  Username: ${pc.cyan(user.name)}`);
    } else if (cachedUser?.name) {
      console.log(`  Username: ${pc.cyan(cachedUser.name)}`);
    }
    if (user.email) {
      console.log(`  Email: ${pc.dim(user.email)}`);
    } else if (cachedUser?.email) {
      console.log(`  Email: ${pc.dim(cachedUser.email)}`);
    }
    console.log(`  Token: ${pc.dim(token.slice(0, 11) + '...')}`);
    return;
  }

  console.log(pc.yellow('Token may be invalid or expired.'));
  console.log(pc.dim('Run `skillscat login` to re-authenticate.'));
}
