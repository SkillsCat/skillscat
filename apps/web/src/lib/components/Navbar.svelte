<script lang="ts">
  import Logo from './Logo.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import SearchBox from './SearchBox.svelte';
  import UserMenu from './UserMenu.svelte';
  import { goto } from '$app/navigation';

  let mobileMenuOpen = $state(false);
  let searchQuery = $state('');

  function handleSearch(query: string) {
    if (query.trim()) {
      goto(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }
</script>

<nav class="sticky top-0 z-50 bg-bg-base/80 backdrop-blur-sm border-b border-border">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="flex items-center justify-between h-16 gap-4">
      <!-- Logo -->
      <Logo />

      <!-- Search (Desktop) -->
      <div class="hidden md:block flex-1 max-w-md mx-4">
        <SearchBox
          bind:value={searchQuery}
          onSearch={handleSearch}
          placeholder="Search skills..."
        />
      </div>

      <!-- Nav Links (Desktop) -->
      <div class="hidden md:flex items-center gap-6">
        <a href="/trending" class="text-fg-muted hover:text-fg transition-colors text-sm font-medium">
          Trending
        </a>
        <a href="/categories" class="text-fg-muted hover:text-fg transition-colors text-sm font-medium">
          Categories
        </a>
      </div>

      <!-- Right Side -->
      <div class="flex items-center gap-3">
        <ThemeToggle />
        <UserMenu />

        <!-- Mobile Menu Button -->
        <button
          class="md:hidden p-2 rounded-lg hover:bg-bg-muted transition-colors"
          onclick={() => mobileMenuOpen = !mobileMenuOpen}
          aria-label="Toggle menu"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            {#if mobileMenuOpen}
              <path d="M18 6 6 18M6 6l12 12" />
            {:else}
              <path d="M4 6h16M4 12h16M4 18h16" />
            {/if}
          </svg>
        </button>
      </div>
    </div>

    <!-- Mobile Menu -->
    {#if mobileMenuOpen}
      <div class="md:hidden py-4 border-t border-border">
        <div class="mb-4">
          <SearchBox
            bind:value={searchQuery}
            onSearch={handleSearch}
            placeholder="Search skills..."
          />
        </div>
        <div class="flex flex-col gap-2">
          <a
            href="/trending"
            class="px-3 py-2 rounded-lg text-fg-muted hover:text-fg hover:bg-bg-muted transition-colors"
            onclick={() => mobileMenuOpen = false}
          >
            Trending
          </a>
          <a
            href="/categories"
            class="px-3 py-2 rounded-lg text-fg-muted hover:text-fg hover:bg-bg-muted transition-colors"
            onclick={() => mobileMenuOpen = false}
          >
            Categories
          </a>
        </div>
      </div>
    {/if}
  </div>
</nav>
