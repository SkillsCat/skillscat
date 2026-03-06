<script lang="ts">
  import { DropdownMenu } from 'bits-ui';
  import { goto } from '$app/navigation';
  import { signOut } from '$lib/auth-client';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import type { CurrentUser } from '$lib/types';
  import { fly } from 'svelte/transition';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
    ArrowDown01Icon,
    Bookmark02Icon,
    Settings01Icon,
    Logout01Icon,
    SparklesIcon,
    Mail01Icon
  } from '@hugeicons/core-free-icons';

  interface Props {
    currentUser: CurrentUser;
    unreadCount?: number;
    open?: boolean;
  }

  let { currentUser, unreadCount = 0, open = $bindable(false) }: Props = $props();

  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  async function handleSignOut() {
    await signOut();
    await goto('/', { invalidateAll: true });
  }
</script>

<DropdownMenu.Root bind:open={open}>
  <DropdownMenu.Trigger class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-bg-muted transition-colors">
    <div class="avatar-wrapper">
      <Avatar
        src={currentUser.image}
        fallback={currentUser.name}
        alt={currentUser.name || messages.userMenu.userAlt}
        size="sm"
        border={false}
        useGithubFallback
      />
      {#if unreadCount > 0}
        <span class="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
      {/if}
    </div>
    <HugeiconsIcon icon={ArrowDown01Icon} size={16} className="text-fg-muted" />
  </DropdownMenu.Trigger>

  <DropdownMenu.Portal>
    <DropdownMenu.Content
      forceMount
      side="bottom"
      align="end"
      sideOffset={8}
    >
      {#snippet child({ wrapperProps, props, open: isOpen })}
        {#if isOpen}
          <div {...wrapperProps}>
            <div
              {...props}
              class="dropdown-content"
              transition:fly={{ y: -5, duration: 150 }}
            >
              <div class="dropdown-header">
                <p class="dropdown-name">{currentUser.name}</p>
                <p class="dropdown-email">{currentUser.email}</p>
              </div>

              <DropdownMenu.Separator class="dropdown-separator" />

              <DropdownMenu.Group>
                <a href="/user/skills" class="dropdown-item">
                  <HugeiconsIcon icon={SparklesIcon} size={16} />
                  {messages.userMenu.mySkills}
                </a>

                <a href="/user/messages" class="dropdown-item">
                  <HugeiconsIcon icon={Mail01Icon} size={16} />
                  {messages.userMenu.messages}
                  {#if unreadCount > 0}
                    <span class="menu-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                  {/if}
                </a>

                <a href="/bookmarks" class="dropdown-item">
                  <HugeiconsIcon icon={Bookmark02Icon} size={16} />
                  {messages.userMenu.bookmarks}
                </a>

                <a href="/user/account" class="dropdown-item">
                  <HugeiconsIcon icon={Settings01Icon} size={16} />
                  {messages.userMenu.settings}
                </a>
              </DropdownMenu.Group>

              <DropdownMenu.Separator class="dropdown-separator" />

              <DropdownMenu.Item class="dropdown-item dropdown-item-danger" onSelect={handleSignOut}>
                <HugeiconsIcon icon={Logout01Icon} size={16} />
                {messages.userMenu.signOut}
              </DropdownMenu.Item>
            </div>
          </div>
        {/if}
      {/snippet}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
  .avatar-wrapper {
    position: relative;
  }

  .notification-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    color: white;
    background: #ef4444;
    border-radius: 9999px;
    border: 2px solid var(--background);
  }

  .menu-badge {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 20px;
    text-align: center;
    color: white;
    background: var(--primary);
    border-radius: 9999px;
  }

  .dropdown-content {
    min-width: 14rem;
    background-color: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    padding: 0.5rem 0;
    z-index: 50;
  }

  .dropdown-header {
    padding: 0.75rem 1rem;
  }

  .dropdown-name {
    font-weight: 500;
    color: var(--foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown-email {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown-separator {
    height: 1px;
    background-color: var(--border);
    margin: 0.5rem 0;
  }

  :global(.dropdown-item) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    color: var(--foreground);
    text-decoration: none;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  :global(.dropdown-item:hover),
  :global(.dropdown-item[data-highlighted]) {
    background-color: var(--muted);
  }

  :global(.dropdown-item-danger) {
    color: var(--destructive);
  }

  :global(.dropdown-item-danger:hover),
  :global(.dropdown-item-danger[data-highlighted]) {
    background-color: rgba(239, 68, 68, 0.1);
  }
</style>
