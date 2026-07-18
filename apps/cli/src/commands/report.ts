import pc from 'picocolors';

import { getBaseUrl, getValidToken } from '../utils/auth/auth';
import { parseHttpError, parseNetworkError } from '../utils/core/errors';
import { fetchWithTimeout } from '../utils/core/fetch';
import { error, prompt, success } from '../utils/core/ui';

interface ReportOptions {
  reason?: 'security' | 'copyright';
  details?: string;
}

interface ReportResponse {
  success?: boolean;
  error?: string;
  message?: string;
  report?: {
    openSecurityReportCount: number;
    riskLevel: 'low' | 'mid' | 'high' | 'fatal';
    premiumEscalated: boolean;
  };
}

function normalizeReason(value: string | undefined): 'security' | 'copyright' | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'security' || normalized === 'copyright') {
    return normalized;
  }
  return null;
}

export async function report(slug: string, options: ReportOptions = {}): Promise<void> {
  const token = await getValidToken();
  if (!token) {
    error('Authentication required.');
    console.log(pc.dim('Run `skillscat login` first.'));
    process.exit(1);
  }

  let reason = normalizeReason(options.reason);
  if (!reason) {
    const answer = await prompt('Report reason [security/copyright]: ');
    reason = normalizeReason(answer);
  }

  if (!reason) {
    error('Invalid report reason. Use `security` or `copyright`.');
    process.exit(1);
  }

  const baseUrl = getBaseUrl();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${baseUrl}/api/skills/${encodeURIComponent(slug)}/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: baseUrl,
        'User-Agent': 'skillscat-cli/0.1.0',
      },
      body: JSON.stringify({
        reason,
        details: options.details || undefined,
      }),
    });
  } catch (requestError) {
    const parsed = parseNetworkError(requestError);
    error(parsed.message);
    if (parsed.suggestion) {
      console.log(pc.dim(parsed.suggestion));
    }
    process.exit(1);
  }

  let payload: ReportResponse = {};
  try {
    payload = await response.json() as ReportResponse;
  } catch {
    // Preserve the HTTP status when an upstream error body is not JSON.
  }
  if (!response.ok || !payload.success) {
    const httpError = parseHttpError(response.status, response.statusText);
    error(payload.error || payload.message || httpError.message || 'Failed to submit report');
    process.exit(1);
  }

  success(payload.message || 'Report submitted');

  if (reason === 'security' && payload.report) {
    console.log(`  Open security reports: ${pc.cyan(String(payload.report.openSecurityReportCount))}`);
    console.log(`  Risk level: ${pc.cyan(payload.report.riskLevel)}`);
    if (payload.report.premiumEscalated) {
      console.log(`  ${pc.yellow('Premium review queued')}`);
    }
  }
}
