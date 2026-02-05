import pc from 'picocolors';

/**
 * Network error codes and their friendly messages
 */
const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'Connection refused. The server may be down or unreachable.',
  ENOTFOUND: 'Could not resolve hostname. Check your internet connection.',
  ETIMEDOUT: 'Connection timed out. The server may be slow or unreachable.',
  ECONNRESET: 'Connection was reset. Please try again.',
  EPIPE: 'Connection was closed unexpectedly.',
  EHOSTUNREACH: 'Host is unreachable. Check your network connection.',
  ENETUNREACH: 'Network is unreachable. Check your internet connection.',
  ECONNABORTED: 'Connection was aborted.',
  EAI_AGAIN: 'DNS lookup timed out. Please try again.',
  CERT_HAS_EXPIRED: 'SSL certificate has expired.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed certificate detected.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify SSL certificate.',
  SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate in chain.',
  UNABLE_TO_GET_ISSUER_CERT: 'Unable to get certificate issuer.',
};

/**
 * HTTP status codes and their friendly messages
 */
const HTTP_ERRORS: Record<number, string> = {
  400: 'Bad request. Please check your input.',
  401: 'Authentication required. Run `skillscat login` first.',
  403: 'Access denied. You do not have permission for this action.',
  404: 'Not found. The requested resource does not exist.',
  408: 'Request timed out. Please try again.',
  429: 'Rate limit exceeded. Please wait and try again later.',
  500: 'Server error. Please try again later.',
  502: 'Bad gateway. The server may be temporarily unavailable.',
  503: 'Service unavailable. Please try again later.',
  504: 'Gateway timeout. The server is taking too long to respond.',
};

export interface FriendlyError {
  message: string;
  suggestion?: string;
  isRetryable: boolean;
}

/**
 * Parse a network error and return a friendly message
 */
export function parseNetworkError(error: unknown): FriendlyError {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code && NETWORK_ERRORS[code]) {
      const isRetryable = ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code);
      return {
        message: NETWORK_ERRORS[code],
        suggestion: isRetryable ? 'Try again in a few moments.' : 'Check your network settings.',
        isRetryable,
      };
    }

    // Check for SSL/TLS errors in message
    if (error.message.includes('certificate') || error.message.includes('SSL') || error.message.includes('TLS')) {
      return {
        message: 'SSL/TLS certificate error.',
        suggestion: 'The server certificate may be invalid or expired.',
        isRetryable: false,
      };
    }

    // Generic fetch error
    if (error.message.includes('fetch')) {
      return {
        message: 'Unable to connect to the server.',
        suggestion: 'Check your internet connection and try again.',
        isRetryable: true,
      };
    }
  }

  return {
    message: 'An unexpected network error occurred.',
    suggestion: 'Please try again.',
    isRetryable: true,
  };
}

/**
 * Parse an HTTP error and return a friendly message
 */
export function parseHttpError(status: number, statusText?: string): FriendlyError {
  const message = HTTP_ERRORS[status] || `HTTP error ${status}${statusText ? `: ${statusText}` : ''}`;
  const isRetryable = status >= 500 || status === 408 || status === 429;

  let suggestion: string | undefined;
  if (status === 401) {
    suggestion = 'Run `skillscat login` to authenticate.';
  } else if (status === 429) {
    suggestion = 'Wait a few minutes before trying again.';
  } else if (isRetryable) {
    suggestion = 'Try again in a few moments.';
  }

  return { message, suggestion, isRetryable };
}

/**
 * Format a friendly error for display
 */
export function formatError(error: FriendlyError): string {
  let output = pc.red(error.message);
  if (error.suggestion) {
    output += '\n' + pc.dim(error.suggestion);
  }
  return output;
}

/**
 * Handle and display a fetch error
 */
export function handleFetchError(error: unknown): FriendlyError {
  return parseNetworkError(error);
}

/**
 * Handle and display an HTTP response error
 */
export function handleHttpError(response: Response): FriendlyError {
  return parseHttpError(response.status, response.statusText);
}
