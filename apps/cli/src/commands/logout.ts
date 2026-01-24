import pc from 'picocolors';
import { clearConfig, isAuthenticated, getUser } from '../utils/auth.js';

export async function logout(): Promise<void> {
  if (!isAuthenticated()) {
    console.log(pc.yellow('Not currently logged in.'));
    return;
  }

  const user = getUser();
  clearConfig();

  console.log(pc.green(`Successfully logged out${user?.name ? ` from ${user.name}` : ''}.`));
}
