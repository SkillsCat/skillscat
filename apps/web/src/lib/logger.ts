/**
 * Logger Utility
 *
 * Creates prefixed loggers for consistent logging across the application.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  log: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

/**
 * Create a prefixed logger for a specific module
 * @param prefix - The prefix to add to all log messages (e.g., 'Submit', 'Auth')
 */
export function createLogger(prefix: string): Logger {
  const formatMessage = (message: string) => `[${prefix}] ${message}`;

  return {
    debug: (message: string, ...args: unknown[]) => {
      console.debug(formatMessage(message), ...args);
    },
    info: (message: string, ...args: unknown[]) => {
      console.info(formatMessage(message), ...args);
    },
    log: (message: string, ...args: unknown[]) => {
      console.log(formatMessage(message), ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      console.warn(formatMessage(message), ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      console.error(formatMessage(message), ...args);
    },
  };
}
