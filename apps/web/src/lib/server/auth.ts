import { betterAuth } from 'better-auth';
import { env } from '$env/dynamic/private';

// Create auth instance with conditional database configuration
// In production, this will use Cloudflare D1 via platform.env.DB
// During build/dev, we use a memory-based fallback

export const auth = betterAuth({
  // Database will be configured at runtime in Cloudflare Workers
  database: undefined as any,
  // Use environment secret or a placeholder for build
  secret: env?.BETTER_AUTH_SECRET || 'placeholder-secret-for-build-only',
  emailAndPassword: {
    enabled: false // We only use social logins
  },
  socialProviders: {
    github: {
      clientId: env?.GITHUB_CLIENT_ID || 'placeholder',
      clientSecret: env?.GITHUB_CLIENT_SECRET || 'placeholder'
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24 // Update session every 24 hours
  },
  trustedOrigins: [
    'http://localhost:5173',
    'https://skillscat.com'
  ]
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
