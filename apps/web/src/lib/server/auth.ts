import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema';

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

export function createAuth(env: AuthEnv, baseURL?: string) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    baseURL: baseURL || 'https://skills.cat',
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
      }
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60 // Cache session in cookie for 5 minutes to reduce DB queries
      }
    },
    trustedOrigins: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://skills.cat'
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
