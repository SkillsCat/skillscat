import { success as showSuccess, warn as showWarning } from '../utils/core/ui';
import { clearConfig, isAuthenticated, getUser } from '../utils/auth/auth';

export async function logout(): Promise<void> {
  if (!isAuthenticated()) {
    showWarning('Not currently logged in.');
    return;
  }

  const user = getUser();
  clearConfig();

  showSuccess(`Successfully logged out${user?.name ? ` from ${user.name}` : ''}.`);
}
