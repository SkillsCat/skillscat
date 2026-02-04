import pc from 'picocolors';
import { getConfigDir, getAuthPath, getSettingsPath, getInstalledDbPath, getRegistryUrl } from './config.js';

let verboseEnabled = false;

/**
 * Enable or disable verbose mode
 */
export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return verboseEnabled;
}

/**
 * Log a message only if verbose mode is enabled
 */
export function verboseLog(message: string, ...args: unknown[]): void {
  if (!verboseEnabled) return;
  console.log(pc.dim(`[verbose] ${message}`), ...args);
}

/**
 * Log request details
 */
export function verboseRequest(method: string, url: string, headers?: Record<string, string>): void {
  if (!verboseEnabled) return;
  console.log(pc.dim(`[verbose] ${pc.cyan(method)} ${url}`));
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      // Mask authorization header
      const displayValue = key.toLowerCase() === 'authorization' ? '***' : value;
      console.log(pc.dim(`[verbose]   ${key}: ${displayValue}`));
    }
  }
}

/**
 * Log response details
 */
export function verboseResponse(status: number, statusText: string, timing?: number): void {
  if (!verboseEnabled) return;
  const statusColor = status >= 400 ? pc.red : status >= 300 ? pc.yellow : pc.green;
  let message = `[verbose] ${statusColor(`${status} ${statusText}`)}`;
  if (timing !== undefined) {
    message += pc.dim(` (${timing}ms)`);
  }
  console.log(pc.dim(message));
}

/**
 * Log config file locations
 */
export function verboseConfig(): void {
  if (!verboseEnabled) return;
  console.log(pc.dim('[verbose] Configuration:'));
  console.log(pc.dim(`[verbose]   Config dir: ${getConfigDir()}`));
  console.log(pc.dim(`[verbose]   Auth file: ${getAuthPath()}`));
  console.log(pc.dim(`[verbose]   Settings file: ${getSettingsPath()}`));
  console.log(pc.dim(`[verbose]   Installed DB: ${getInstalledDbPath()}`));
  console.log(pc.dim(`[verbose]   Registry URL: ${getRegistryUrl()}`));
}

/**
 * Log timing information
 */
export function verboseTiming(label: string, startTime: number): void {
  if (!verboseEnabled) return;
  const elapsed = Date.now() - startTime;
  console.log(pc.dim(`[verbose] ${label}: ${elapsed}ms`));
}
