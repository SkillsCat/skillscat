/**
 * Notification Helper
 *
 * Provides utility functions for creating notifications
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface NotificationData {
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a notification for a user
 */
export async function createNotification(
  db: D1Database,
  userId: string,
  data: NotificationData
): Promise<void> {
  await db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    data.type,
    data.title,
    data.message,
    data.metadata ? JSON.stringify(data.metadata) : null,
    Date.now()
  ).run();
}

/**
 * Create a notification for skill curation conversion
 */
export async function notifySkillCurated(
  db: D1Database,
  userId: string,
  skillSlug: string,
  skillId: string
): Promise<void> {
  await createNotification(db, userId, {
    type: 'skill_curated',
    title: 'Your skill has been curated!',
    message: `Your skill "${skillSlug}" has been converted to public as part of the SkillsCat curation process. Your skill is now discoverable by everyone in the registry.`,
    metadata: { skillId, skillSlug }
  });
}
