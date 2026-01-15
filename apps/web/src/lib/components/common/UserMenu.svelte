<script lang="ts">
  /**
   * UserMenu - 用户菜单组件
   * 使用 Bits UI DropdownMenu 组件实现
   */
  import { DropdownMenu } from 'bits-ui';
  import { signOut, useSession } from '$lib/auth-client';
  import { LoginDialog } from '$lib/components';
  import { fly, fade } from 'svelte/transition';

  const session = useSession();

  let showLoginDialog = $state(false);

  function handleSignOut() {
    signOut();
  }
</script>

{#if $session.data?.user}
  <!-- Logged in state -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-bg-muted transition-colors"
    >
      <img
        src={$session.data.user.image || `https://github.com/${$session.data.user.name}.png`}
        alt={$session.data.user.name || 'User'}
        class="w-8 h-8 rounded-full"
      />
      <svg class="w-4 h-4 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </DropdownMenu.Trigger>

    <DropdownMenu.Portal>
      <DropdownMenu.Content
        forceMount
        side="bottom"
        align="end"
        sideOffset={8}
      >
        {#snippet child({ wrapperProps, props, open })}
          {#if open}
            <div {...wrapperProps}>
              <div
                {...props}
                class="dropdown-content"
                transition:fly={{ y: -5, duration: 150 }}
              >
                <div class="dropdown-header">
                  <p class="dropdown-name">{$session.data?.user?.name}</p>
                  <p class="dropdown-email">{$session.data?.user?.email}</p>
                </div>

                <DropdownMenu.Separator class="dropdown-separator" />

                <DropdownMenu.Group>
                  <a href="/favorites" class="dropdown-item">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    My Favorites
                  </a>

                  <a href="/settings" class="dropdown-item">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Settings
                  </a>
                </DropdownMenu.Group>

                <DropdownMenu.Separator class="dropdown-separator" />

                <DropdownMenu.Item class="dropdown-item dropdown-item-danger" onSelect={handleSignOut}>
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign Out
                </DropdownMenu.Item>
              </div>
            </div>
          {/if}
        {/snippet}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{:else}
  <!-- Logged out state -->
  <button
    onclick={() => (showLoginDialog = true)}
    class="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
           bg-primary text-white hover:bg-primary-hover transition-colors"
  >
    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
    </svg>
    <span class="hidden sm:inline">Sign In</span>
  </button>

  <LoginDialog isOpen={showLoginDialog} onClose={() => (showLoginDialog = false)} />
{/if}

<style>
  .dropdown-content {
    min-width: 14rem;
    background-color: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
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
