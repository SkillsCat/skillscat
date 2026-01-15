<script lang="ts">
  import { signOut, useSession } from '$lib/auth-client';
  import { LoginDialog } from '$lib/components';

  const session = useSession();

  let showDropdown = $state(false);
  let showLoginDialog = $state(false);

  function handleSignOut() {
    signOut();
    showDropdown = false;
  }
</script>

{#if $session.data?.user}
  <!-- Logged in state -->
  <div class="relative">
    <button
      onclick={() => (showDropdown = !showDropdown)}
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
    </button>

    {#if showDropdown}
      <div
        class="absolute right-0 top-full mt-2 w-56 bg-bg-default border border-border rounded-lg shadow-lg py-2 z-50"
      >
        <div class="px-4 py-2 border-b border-border">
          <p class="font-medium text-fg truncate">{$session.data.user.name}</p>
          <p class="text-sm text-fg-muted truncate">{$session.data.user.email}</p>
        </div>
        <a
          href="/favorites"
          class="block px-4 py-2 text-sm text-fg hover:bg-bg-muted transition-colors"
          onclick={() => (showDropdown = false)}
        >
          My Favorites
        </a>
        <a
          href="/settings"
          class="block px-4 py-2 text-sm text-fg hover:bg-bg-muted transition-colors"
          onclick={() => (showDropdown = false)}
        >
          Settings
        </a>
        <hr class="my-2 border-border" />
        <button
          onclick={handleSignOut}
          class="w-full text-left px-4 py-2 text-sm text-error hover:bg-bg-muted transition-colors"
        >
          Sign Out
        </button>
      </div>
    {/if}
  </div>
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
