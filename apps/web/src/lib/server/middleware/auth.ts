/**
 * Auth Middleware
 *
 * Provides unified authentication context supporting both
 * session-based auth and API token auth
 */

import type { D1Database } from '@cloudflare/workers-types';
import { validateApiToken, type TokenInfo } from '../api-auth';

export interface AuthContext {
  userId: string | null;
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  authMethod: 'session' | 'token' | null;
  tokenInfo: TokenInfo | null;
  scopes: string[];
}

interface SessionAuth {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

/**
 * Get authentication context from request
 * Supports both Bearer token and session-based authentication
 */
export async function getAuthContext(
  request: Request,
  locals: { auth?: () => Promise<SessionAuth> },
  db: D1Database | undefined
): Promise<AuthContext> {
  const authHeader = request.headers.get('Authorization');

  // Try Bearer token auth first
  if (authHeader?.startsWith('Bearer ') && db) {
    const token = authHeader.slice(7);
    const tokenInfo = await validateApiToken(token, db);

    if (tokenInfo) {
      return {
        userId: tokenInfo.userId,
        user: { id: tokenInfo.userId },
        authMethod: 'token',
        tokenInfo,
        scopes: tokenInfo.scopes,
      };
    }
  }

  // Fall back to session auth
  if (locals.auth) {
    const session = await locals.auth();
    if (session?.user) {
      return {
        userId: session.user.id,
        user: session.user,
        authMethod: 'session',
        tokenInfo: null,
        scopes: ['read', 'write'], // Session has full access
      };
    }
  }

  return {
    userId: null,
    user: null,
    authMethod: null,
    tokenInfo: null,
    scopes: [],
  };
}

/**
 * Check if auth context has a specific scope
 */
export function hasScope(auth: AuthContext, scope: string): boolean {
  return auth.scopes.includes(scope);
}

/**
 * Require authentication - throws if not authenticated
 */
export function requireAuth(auth: AuthContext): asserts auth is AuthContext & { userId: string; user: NonNullable<AuthContext['user']> } {
  if (!auth.userId || !auth.user) {
    throw new Error('Authentication required');
  }
}

/**
 * Require a specific scope - throws if scope not present
 */
export function requireScope(auth: AuthContext, scope: string): void {
  if (!hasScope(auth, scope)) {
    throw new Error(`Scope '${scope}' required`);
  }
}
