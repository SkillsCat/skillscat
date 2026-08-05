import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
const SESSION_COOKIE_CACHE_MAX_AGE_SECONDS = 5 * 60;

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  PUBLIC_APP_URL?: string;
}

/**
 * Resolve the canonical base URL for auth (OAuth callback URLs are derived
 * from it). An explicit env URL wins over the request origin so local
 * development behind a proxy never falls back to localhost.
 */
export function resolveAuthBaseURL(env: Pick<AuthEnv, 'PUBLIC_APP_URL'>, fallback?: string): string {
  return env.PUBLIC_APP_URL?.trim() || fallback || 'https://skills.cat';
}

export function createAuth(env: AuthEnv, baseURL?: string) {
  const db = drizzle(env.DB, { schema });
  const resolvedBaseURL = resolveAuthBaseURL(env, baseURL);

  return betterAuth({
    baseURL: resolvedBaseURL,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: false // We only use social logins
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        scope: ['read:org'],
      }
    },
    session: {
      // Keep web sessions alive longer so returning users do not need to
      // re-authorize with GitHub every week, while still using rolling refresh.
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_MAX_AGE_SECONDS
      }
    },
    trustedOrigins: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://skills.cat',
      // Proxy origin used for non-localhost development OAuth flows.
      ...(env.PUBLIC_APP_URL?.trim() ? [env.PUBLIC_APP_URL.trim()] : []),
    ]
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session']['session'];
export type User = Auth['$Infer']['Session']['user'];

/**
 * Link an author record to a user after GitHub OAuth signup.
 * This should be called after a user signs up via GitHub OAuth.
 * It updates the authors table to set userId where github_id matches the user's GitHub ID.
 */
export async function linkAuthorToUser(
  db: D1Database,
  userId: string,
  githubId: number
): Promise<void> {
  const now = Date.now();

  // Update authors table to link the author record to the user
  await db.prepare(`
    UPDATE authors
    SET user_id = ?, updated_at = ?
    WHERE github_id = ? AND user_id IS NULL
  `).bind(userId, now, githubId).run();

  // Also update skills table to set ownerId for matching repo_owner
  // First, get the author's username
  const author = await db.prepare(`
    SELECT username FROM authors WHERE github_id = ?
  `).bind(githubId).first<{ username: string }>();

  if (author) {
    await db.prepare(`
      UPDATE skills
      SET owner_id = ?, updated_at = ?
      WHERE repo_owner = ? AND owner_id IS NULL
    `).bind(userId, now, author.username).run();
  }
}
