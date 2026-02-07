<script lang="ts">
  import { Button, SettingsSection, ErrorState } from "$lib/components";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Building04Icon,
    SparklesIcon,
    MailOpen01Icon,
    MailMinus01Icon,
    CheckListIcon,
  } from "@hugeicons/core-free-icons";

  interface OrgInviteMetadata {
    orgId: string;
    orgSlug: string;
    orgName: string;
    inviterId: string;
    inviterName: string;
    role: "admin" | "member";
  }

  interface Notification {
    id: string;
    type: string;
    title: string;
    message: string | null;
    metadata: OrgInviteMetadata | null;
    read: boolean;
    processed: boolean;
    createdAt: number;
    processedAt: number | null;
  }

  let notifications = $state<Notification[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let processingIds = $state<Set<string>>(new Set());
  let markingAllRead = $state(false);

  const hasUnread = $derived(notifications.some((n) => !n.read));

  $effect(() => {
    loadNotifications();
  });

  async function loadNotifications() {
    loading = true;
    error = null;
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = (await res.json()) as { notifications: Notification[] };
        notifications = data.notifications;
      } else {
        error = "Failed to load messages";
      }
    } catch {
      error = "Failed to load messages";
    } finally {
      loading = false;
    }
  }

  async function markAllAsRead() {
    if (markingAllRead || !hasUnread) return;
    markingAllRead = true;
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (res.ok) {
        notifications = notifications.map((n) => ({ ...n, read: true }));
      }
    } catch {
      // Silently fail
    } finally {
      markingAllRead = false;
    }
  }

  async function handleAccept(notification: Notification) {
    if (processingIds.has(notification.id)) return;

    processingIds = new Set([...processingIds, notification.id]);
    try {
      const res = await fetch(`/api/notifications/${notification.id}/accept`, {
        method: "POST",
      });
      if (res.ok) {
        // Update local state
        notifications = notifications.map((n) =>
          n.id === notification.id ? { ...n, processed: true } : n,
        );
      }
    } catch {
      // Silently fail
    } finally {
      processingIds = new Set(
        [...processingIds].filter((id) => id !== notification.id),
      );
    }
  }

  async function handleReject(notification: Notification) {
    if (processingIds.has(notification.id)) return;

    processingIds = new Set([...processingIds, notification.id]);
    try {
      const res = await fetch(`/api/notifications/${notification.id}/reject`, {
        method: "POST",
      });
      if (res.ok) {
        // Update local state
        notifications = notifications.map((n) =>
          n.id === notification.id ? { ...n, processed: true } : n,
        );
      }
    } catch {
      // Silently fail
    } finally {
      processingIds = new Set(
        [...processingIds].filter((id) => id !== notification.id),
      );
    }
  }

  function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  }

  function getNotificationIcon(type: string) {
    switch (type) {
      case "org_invite":
        return Building04Icon;
      case "skill_shared":
        return SparklesIcon;
      default:
        return MailOpen01Icon;
    }
  }
</script>

<div class="messages-page">
  <div class="page-header">
    <div class="page-header-row">
      <div>
        <h1>Messages</h1>
        <p class="description">View your notifications and invitations.</p>
      </div>
      {#if hasUnread}
        <Button
          variant="cute"
          size="sm"
          onclick={markAllAsRead}
          disabled={markingAllRead}
        >
          <HugeiconsIcon icon={CheckListIcon} size={16} />
          {markingAllRead ? 'Marking...' : 'Mark all as read'}
        </Button>
      {/if}
    </div>
  </div>

  <SettingsSection
    title="All Messages"
    description="Your notifications and organization invitations."
  >
    {#if loading}
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading messages...</p>
      </div>
    {:else if error}
      <ErrorState
        title="Failed to Load"
        message={error}
        primaryActionText="Try Again"
        primaryActionClick={loadNotifications}
      />
    {:else if notifications.length === 0}
      <div class="empty-state">
        <div class="empty-icon">
          <HugeiconsIcon icon={MailMinus01Icon} size={48} />
        </div>
        <h3>No messages</h3>
        <p>You don't have any notifications yet.</p>
      </div>
    {:else}
      <div class="notifications-list">
        {#each notifications as notification (notification.id)}
          <div
            class="notification-card"
            class:notification-unread={!notification.read}
            class:notification-processed={notification.processed}
          >
            <div class="notification-row">
              <div class="notification-icon">
                <HugeiconsIcon icon={getNotificationIcon(notification.type)} size={24} />
              </div>
              <div class="notification-content">
                <div class="notification-header">
                  <h4 class="notification-title">{notification.title}</h4>
                  <span class="notification-time"
                    >{formatRelativeTime(notification.createdAt)}</span
                  >
                </div>
                {#if notification.message}
                  <p class="notification-message">{notification.message}</p>
                {/if}
                {#if notification.type === "org_invite" && notification.processed}
                  <p class="notification-status">
                    {notification.metadata ? "Invitation processed" : "Processed"}
                  </p>
                {/if}
              </div>
            </div>
            {#if notification.type === "org_invite" && !notification.processed && notification.metadata}
              <div class="notification-actions">
                <Button
                  variant="cute"
                  size="sm"
                  onclick={() => handleAccept(notification)}
                  disabled={processingIds.has(notification.id)}
                >
                  {processingIds.has(notification.id)
                    ? "Accepting..."
                    : "Accept"}
                </Button>
                <Button
                  variant="cute-secondary"
                  size="sm"
                  onclick={() => handleReject(notification)}
                  disabled={processingIds.has(notification.id)}
                >
                  Decline
                </Button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </SettingsSection>
</div>

<style>
  .messages-page {
    max-width: 800px;
  }

  .page-header {
    margin-bottom: 2rem;
  }

  .page-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }

  .description {
    color: var(--muted-foreground);
    font-size: 0.9375rem;
  }

  /* States */
  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    text-align: center;
    background: var(--background);
    border-radius: var(--radius-md);
  }

  .loading-spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 0.75rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .empty-icon {
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
  }

  .empty-state h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--foreground);
  }

  .empty-state p {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  /* Notifications List */
  .notifications-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .notification-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: border-color 0.15s ease;
  }

  .notification-card:hover {
    border-color: var(--primary);
  }

  .notification-unread {
    background: var(--primary-subtle);
    border-color: var(--primary);
  }

  .notification-processed {
    opacity: 0.7;
  }

  .notification-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .notification-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .notification-content {
    flex: 1;
    min-width: 0;
  }

  .notification-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .notification-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .notification-time {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    flex-shrink: 0;
  }

  .notification-message {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin: 0;
  }

  .notification-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .notification-status {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    font-style: italic;
    margin: 0;
  }

  @media (max-width: 640px) {
    .notification-row {
      flex-direction: column;
      align-items: flex-start;
    }

    .notification-header {
      flex-direction: column;
      gap: 0.25rem;
    }

    .notification-actions {
      justify-content: flex-start;
    }
  }
</style>
