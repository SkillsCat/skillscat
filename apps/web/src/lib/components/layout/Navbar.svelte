<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { Logo, ThemeToggle, SearchBox, UserMenu } from '$lib/components';
  import { CATEGORIES } from '$lib/constants/categories';
  import { goto } from '$app/navigation';

  let mobileMenuOpen = $state(false);
  let searchQuery = $state('');

  function handleSearch(query: string) {
    if (query.trim()) {
      goto(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  // Split categories into columns for better display
  const categoryColumns = $derived(() => {
    const half = Math.ceil(CATEGORIES.length / 2);
    return [CATEGORIES.slice(0, half), CATEGORIES.slice(half)];
  });
</script>

<nav class="navbar">
  <div class="navbar-container">
    <div class="navbar-inner">
      <!-- Logo -->
      <Logo />

      <!-- Search (Desktop) -->
      <div class="search-desktop">
        <SearchBox
          bind:value={searchQuery}
          onSearch={handleSearch}
          placeholder="Search skills..."
        />
      </div>

      <!-- Nav Links (Desktop) with NavigationMenu -->
      <div class="nav-links">
        <NavigationMenu.Root class="nav-menu-root">
          <NavigationMenu.List class="nav-menu-list">
            <!-- Trending Link -->
            <NavigationMenu.Item>
              <NavigationMenu.Link
                href="/trending"
                class="nav-link"
              >
                Trending
              </NavigationMenu.Link>
            </NavigationMenu.Item>

            <!-- Categories Dropdown -->
            <NavigationMenu.Item value="categories">
              <NavigationMenu.Trigger class="nav-link nav-trigger">
                Categories
                <svg
                  class="chevron-icon"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </NavigationMenu.Trigger>

              <NavigationMenu.Content class="nav-content">
                <div class="dropdown-grid">
                  {#each categoryColumns() as column}
                    <ul class="category-list">
                      {#each column as category}
                        <li>
                          <NavigationMenu.Link
                            href="/categories/{category.slug}"
                            class="category-item"
                          >
                            <span class="category-emoji">{category.emoji}</span>
                            <div>
                              <div class="category-name">{category.name}</div>
                              <div class="category-desc">{category.description}</div>
                            </div>
                          </NavigationMenu.Link>
                        </li>
                      {/each}
                    </ul>
                  {/each}
                </div>
                <div class="dropdown-footer">
                  <NavigationMenu.Link href="/categories" class="view-all-link">
                    View all categories →
                  </NavigationMenu.Link>
                </div>
              </NavigationMenu.Content>
            </NavigationMenu.Item>

            <!-- Indicator -->
            <NavigationMenu.Indicator class="nav-indicator">
              <div class="nav-indicator-arrow"></div>
            </NavigationMenu.Indicator>
          </NavigationMenu.List>

          <!-- Viewport - Required for content rendering -->
          <NavigationMenu.Viewport class="nav-viewport" />
        </NavigationMenu.Root>
      </div>

      <!-- Right Side -->
      <div class="navbar-right">
        <ThemeToggle />
        <UserMenu />

        <!-- Mobile Menu Button -->
        <button
          class="mobile-menu-btn"
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
      <div class="mobile-menu">
        <div class="mobile-search">
          <SearchBox
            bind:value={searchQuery}
            onSearch={handleSearch}
            placeholder="Search skills..."
          />
        </div>
        <div class="mobile-links">
          <a
            href="/trending"
            class="mobile-link"
            onclick={() => mobileMenuOpen = false}
          >
            Trending
          </a>
          <a
            href="/categories"
            class="mobile-link"
            onclick={() => mobileMenuOpen = false}
          >
            Categories
          </a>
        </div>
      </div>
    {/if}
  </div>
</nav>

<style>
  .navbar {
    position: sticky;
    top: 0;
    z-index: 50;
    background-color: color-mix(in oklch, var(--background) 80%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }

  .navbar-container {
    max-width: 80rem;
    margin: 0 auto;
    padding: 0 1rem;
  }

  @media (min-width: 640px) {
    .navbar-container {
      padding: 0 1.5rem;
    }
  }

  @media (min-width: 1024px) {
    .navbar-container {
      padding: 0 2rem;
    }
  }

  .navbar-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 4rem;
    gap: 1rem;
  }

  .search-desktop {
    display: none;
    flex: 1;
    max-width: 28rem;
    margin: 0 1rem;
  }

  @media (min-width: 768px) {
    .search-desktop {
      display: block;
    }
  }

  .nav-links {
    display: none;
  }

  @media (min-width: 768px) {
    .nav-links {
      display: block;
    }
  }

  /* NavigationMenu Styles */
  :global(.nav-menu-root) {
    position: relative;
    z-index: 10;
    display: flex;
    justify-content: center;
  }

  :global(.nav-menu-list) {
    display: flex;
    list-style: none;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    margin: 0;
    gap: 0.25rem;
  }

  :global(.nav-link) {
    display: inline-flex;
    align-items: center;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--muted-foreground);
    border-radius: var(--radius);
    text-decoration: none;
    transition: color 0.15s, background-color 0.15s;
  }

  :global(.nav-link:hover),
  :global(.nav-link[data-active]) {
    color: var(--foreground);
    background-color: var(--muted);
  }

  :global(.nav-trigger) {
    cursor: pointer;
    border: none;
    background: transparent;
  }

  :global(.nav-trigger[data-state="open"]) {
    color: var(--foreground);
    background-color: var(--muted);
  }

  :global(.nav-trigger[data-state="open"]) .chevron-icon {
    transform: rotate(180deg);
  }

  .chevron-icon {
    width: 0.75rem;
    height: 0.75rem;
    margin-left: 0.25rem;
    transition: transform 0.2s;
  }

  /* Content - positioned absolute within viewport */
  :global(.nav-content) {
    position: absolute;
    left: 0;
    top: 0;
    width: auto;
  }

  /* Viewport - where content is rendered */
  :global(.nav-viewport) {
    position: absolute;
    left: 50%;
    top: 100%;
    transform: translateX(-50%);
    margin-top: 0.5rem;
    width: var(--bits-navigation-menu-viewport-width);
    height: var(--bits-navigation-menu-viewport-height);
    overflow: hidden;
    background-color: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    transition: width 0.3s ease, height 0.3s ease;
  }

  :global(.nav-viewport[data-state="closed"]) {
    display: none;
  }

  /* Indicator */
  :global(.nav-indicator) {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    display: flex;
    height: 0.625rem;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
    transition: transform 0.25s ease, width 0.25s ease;
  }

  :global(.nav-indicator[data-state="hidden"]) {
    opacity: 0;
  }

  .nav-indicator-arrow {
    position: relative;
    top: 70%;
    width: 0.625rem;
    height: 0.625rem;
    transform: rotate(45deg);
    border-top-left-radius: 2px;
    background-color: var(--border);
  }

  /* Dropdown Content Layout */
  .dropdown-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding: 0.75rem;
    min-width: 500px;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  :global(.category-item) {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    text-decoration: none;
    transition: background-color 0.15s;
  }

  :global(.category-item:hover),
  :global(.category-item[data-highlighted]) {
    background-color: var(--muted);
  }

  .category-emoji {
    font-size: 1.25rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .category-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
    line-height: 1.25;
  }

  .category-desc {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    line-height: 1.4;
    margin-top: 0.125rem;
  }

  .dropdown-footer {
    padding: 0.75rem;
    border-top: 1px solid var(--border);
    background-color: var(--card);
  }

  :global(.view-all-link) {
    display: block;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--primary);
    text-decoration: none;
    text-align: center;
  }

  :global(.view-all-link:hover) {
    text-decoration: underline;
  }

  /* Right Side */
  .navbar-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .mobile-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border: none;
    background: transparent;
    color: var(--foreground);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .mobile-menu-btn:hover {
    background-color: var(--muted);
  }

  @media (min-width: 768px) {
    .mobile-menu-btn {
      display: none;
    }
  }

  /* Mobile Menu */
  .mobile-menu {
    display: block;
    padding: 1rem 0;
    border-top: 1px solid var(--border);
  }

  @media (min-width: 768px) {
    .mobile-menu {
      display: none;
    }
  }

  .mobile-search {
    margin-bottom: 1rem;
  }

  .mobile-links {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .mobile-link {
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    color: var(--muted-foreground);
    text-decoration: none;
    transition: color 0.15s, background-color 0.15s;
  }

  .mobile-link:hover {
    color: var(--foreground);
    background-color: var(--muted);
  }
</style>
