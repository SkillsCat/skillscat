<script lang="ts">
  import UserMenuAuthenticated from '$lib/components/common/UserMenuAuthenticated.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import type { CurrentUser } from '$lib/types';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Login03Icon } from '@hugeicons/core-free-icons';

  interface Props {
    currentUser?: CurrentUser | null;
    unreadCount?: number;
    authPending?: boolean;
  }
  let { currentUser = null, unreadCount = 0, authPending = false }: Props = $props();

  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  let showLoginDialog = $state(false);
  let LoginDialogComponent = $state<typeof import('$lib/components/dialog/LoginDialog.svelte').default | null>(null);

  async function openLoginDialog() {
    if (!LoginDialogComponent) {
      try {
        const module = await import('$lib/components/dialog/LoginDialog.svelte');
        LoginDialogComponent = module.default;
      } catch (error) {
        console.error('Failed to load login dialog:', error);
        return;
      }
    }

    showLoginDialog = true;
  }
</script>

{#if currentUser}
  <UserMenuAuthenticated {currentUser} {unreadCount} />
{:else if authPending}
  <div class="auth-placeholder" aria-hidden="true"></div>
{:else}
  <button
    type="button"
    onclick={() => void openLoginDialog()}
    class="sign-in-btn"
  >
    <HugeiconsIcon icon={Login03Icon} size={16} />
    <span class="hidden sm:inline">{messages.userMenu.signIn}</span>
  </button>

  {#if LoginDialogComponent}
    <LoginDialogComponent
      isOpen={showLoginDialog}
      onClose={() => (showLoginDialog = false)}
    />
  {/if}
{/if}

<style>
  .auth-placeholder {
    width: 6.25rem;
    height: 2.5rem;
    border-radius: var(--radius-full);
    background:
      linear-gradient(
        90deg,
        color-mix(in oklch, var(--fg) 7%, transparent) 0%,
        color-mix(in oklch, var(--fg) 12%, transparent) 50%,
        color-mix(in oklch, var(--fg) 7%, transparent) 100%
      );
    background-size: 200% 100%;
    animation: auth-placeholder-shimmer 1.4s linear infinite;
  }

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

  @keyframes auth-placeholder-shimmer {
    from {
      background-position: 200% 0;
    }

    to {
      background-position: -200% 0;
    }
  }
</style>
