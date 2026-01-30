<script lang="ts">
  /**
   * UserMenu - 用户菜单组件
   * 使用 Bits UI DropdownMenu 组件实现
   */
  import { DropdownMenu } from 'bits-ui';
  import { signOut, useSession } from '$lib/auth-client';
  import { LoginDialog } from '$lib/components';
  import { fly, fade } from 'svelte/transition';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import { ArrowDown01Icon, FavouriteIcon, Settings01Icon, Logout01Icon, Login03Icon, SparklesIcon } from '@hugeicons/core-free-icons';

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
      <HugeiconsIcon icon={ArrowDown01Icon} size={16} className="text-fg-muted" />
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
                  <a href="/settings/skills" class="dropdown-item">
                    <HugeiconsIcon icon={SparklesIcon} size={16} />
                    My Skills
                  </a>

                  <a href="/favorites" class="dropdown-item">
                    <HugeiconsIcon icon={FavouriteIcon} size={16} />
                    My Favorites
                  </a>

                  <a href="/settings" class="dropdown-item">
                    <HugeiconsIcon icon={Settings01Icon} size={16} />
                    Settings
                  </a>
                </DropdownMenu.Group>

                <DropdownMenu.Separator class="dropdown-separator" />

                <DropdownMenu.Item class="dropdown-item dropdown-item-danger" onSelect={handleSignOut}>
                  <HugeiconsIcon icon={Logout01Icon} size={16} />
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
    class="sign-in-btn"
  >
    <HugeiconsIcon icon={Login03Icon} size={16} />
    <span class="hidden sm:inline">Sign In</span>
  </button>

  <LoginDialog isOpen={showLoginDialog} onClose={() => (showLoginDialog = false)} />
{/if}

<style>
  .sign-in-btn {
    --btn-shadow-offset: 3px;
    --btn-shadow-color: oklch(50% 0.22 55);

    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #ffffff;
    background-color: var(--primary);
    border: none;
    border-radius: var(--radius-full);
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    cursor: pointer;
    transform: translateY(0);
    transition:
      transform 0.1s ease,
      box-shadow 0.1s ease,
      background-color 0.15s ease;
  }

  .sign-in-btn:hover {
    --btn-shadow-offset: 5px;
    background-color: var(--primary-hover);
    transform: translateY(-2px);
  }

  .sign-in-btn:active {
    --btn-shadow-offset: 1px;
    transform: translateY(2px);
  }

  :global(.dark) .sign-in-btn {
    --btn-shadow-color: oklch(40% 0.20 55);
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
