<script lang="ts">
  import UserMenuAuthenticated from '$lib/components/common/UserMenuAuthenticated.svelte';
  import LoginDialog from '$lib/components/dialog/LoginDialog.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import type { CurrentUser } from '$lib/types';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import { Login03Icon } from '@hugeicons/core-free-icons';

  interface Props {
    currentUser?: CurrentUser | null;
    unreadCount?: number;
  }
  let { currentUser = null, unreadCount = 0 }: Props = $props();

  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  let showLoginDialog = $state(false);
  function openLoginDialog() {
    showLoginDialog = true;
  }
</script>

{#if currentUser}
  <UserMenuAuthenticated {currentUser} {unreadCount} />
{:else}
  <button
    type="button"
    onclick={openLoginDialog}
    class="sign-in-btn"
  >
    <HugeiconsIcon icon={Login03Icon} size={16} />
    <span class="hidden sm:inline">{messages.userMenu.signIn}</span>
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
</style>
