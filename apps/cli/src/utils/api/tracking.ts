import { getValidToken, getBaseUrl } from '../auth/auth';

/**
 * Track a skill installation on the server.
 * Non-blocking, fail-silent — should never interrupt the install flow.
 */
export async function trackInstallation(slug: string): Promise<void> {
  try {
    const baseUrl = getBaseUrl();
    const token = await getValidToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'skillscat-cli/0.1.0',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    await fetch(`${baseUrl}/api/skills/${encodeURIComponent(slug)}/track-install`, {
      method: 'POST',
      headers,
    });
  } catch {
    // Fail silently — tracking should never block installation
  }
}
