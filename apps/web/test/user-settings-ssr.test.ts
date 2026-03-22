import { describe, expect, it, vi } from 'vitest';

function createDb(resultsByQuery: {
  notifications?: unknown[];
  organizations?: unknown[];
}) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => {
          if (sql.includes('FROM notifications')) {
            return {
              results: resultsByQuery.notifications ?? [],
            };
          }

          if (sql.includes('FROM organizations')) {
            return {
              results: resultsByQuery.organizations ?? [],
            };
          }

          throw new Error(`Unexpected query: ${sql}`);
        }),
      })),
    })),
  };
}

describe('user settings server loads', () => {
  it('loads notifications on the server for the messages page', async () => {
    const db = createDb({
      notifications: [
        {
          id: 'notification-1',
          type: 'org_invite',
          title: 'Join Acme',
          message: 'Acme invited you',
          metadata: JSON.stringify({
            orgId: 'org-1',
            orgSlug: 'acme',
            orgName: 'Acme',
            inviterId: 'user-2',
            inviterName: 'alice',
            role: 'member',
          }),
          read: 0,
          processed: 0,
          created_at: 1710000000000,
          processed_at: null,
        },
      ],
    });

    const { load } = await import('../src/routes/user/messages/+page.server');

    const result = await load({
      locals: {
        auth: vi.fn(async () => ({
          user: { id: 'user-1' },
        })),
      },
      platform: {
        env: {
          DB: db,
        },
      },
    } as never);

    expect(result).toEqual({
      notifications: [
        {
          id: 'notification-1',
          type: 'org_invite',
          title: 'Join Acme',
          message: 'Acme invited you',
          metadata: {
            orgId: 'org-1',
            orgSlug: 'acme',
            orgName: 'Acme',
            inviterId: 'user-2',
            inviterName: 'alice',
            role: 'member',
          },
          read: false,
          processed: false,
          createdAt: 1710000000000,
          processedAt: null,
        },
      ],
    });
  });

  it('loads organizations on the server with page-consumable fields', async () => {
    const db = createDb({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          display_name: 'Acme Inc',
          description: 'Example org',
          avatar_url: 'https://cdn.example.com/acme.png',
          verified_at: 1710000000000,
          role: 'owner',
        },
      ],
    });

    const { load } = await import('../src/routes/user/organizations/+page.server');

    const result = await load({
      locals: {
        auth: vi.fn(async () => ({
          user: { id: 'user-1' },
        })),
      },
      platform: {
        env: {
          DB: db,
        },
      },
    } as never);

    expect(result).toEqual({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          displayName: 'Acme Inc',
          description: 'Example org',
          avatarUrl: 'https://cdn.example.com/acme.png',
          verified: true,
          role: 'owner',
        },
      ],
    });
  });
});
