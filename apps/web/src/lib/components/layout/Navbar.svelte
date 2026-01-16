<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { Logo, ThemeToggle, SearchBox, UserMenu } from '$lib/components';
  import { CATEGORIES } from '$lib/constants/categories';
  import { goto } from '$app/navigation';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import {
    ArrowDown01Icon,
    Menu01Icon,
    Cancel01Icon,
    GitBranchIcon,
    CodeIcon,
    RefreshIcon,
    Bug01Icon,
    EyeIcon,
    TestTubeIcon,
    SecurityLockIcon,
    SpeedTrain01Icon,
    FileScriptIcon,
    EarthIcon,
    Link01Icon,
    Database01Icon,
    DatabaseExportIcon,
    PaintBrush01Icon,
    AccessIcon,
    Settings01Icon,
    Activity01Icon,
    Folder01Icon,
    WorkflowSquare01Icon,
    SparklesIcon
  } from '@hugeicons/core-free-icons';

  let mobileMenuOpen = $state(false);
  let searchQuery = $state('');

  // Icon mapping for categories
  const categoryIcons: Record<string, any> = {
    'git': GitBranchIcon,
    'code-generation': CodeIcon,
    'refactoring': RefreshIcon,
    'debugging': Bug01Icon,
    'code-review': EyeIcon,
    'testing': TestTubeIcon,
    'security': SecurityLockIcon,
    'performance': SpeedTrain01Icon,
    'documentation': FileScriptIcon,
    'i18n': EarthIcon,
    'api': Link01Icon,
    'database': Database01Icon,
    'data-processing': DatabaseExportIcon,
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'devops': Settings01Icon,
    'monitoring': Activity01Icon,
    'file-operations': Folder01Icon,
    'automation': WorkflowSquare01Icon,
    'productivity': SparklesIcon
  };

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
                <span class="chevron-icon">
                  <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
                </span>
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
                            <div class="category-icon">
                              <HugeiconsIcon icon={categoryIcons[category.slug]} size={18} strokeWidth={2} />
                            </div>
                            <div class="category-name">{category.name}</div>
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
          {#if mobileMenuOpen}
            <HugeiconsIcon icon={Cancel01Icon} size={20} strokeWidth={1.5} />
          {:else}
            <HugeiconsIcon icon={Menu01Icon} size={20} strokeWidth={1.5} />
          {/if}
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
    background-color: transparent;
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
    height: 4.5rem;
    gap: 1rem;
  }

  .search-desktop {
    display: none;
    flex: 1;
    max-width: 20rem;
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
    gap: 0.5rem;
  }

  :global(.nav-link) {
    display: inline-flex;
    align-items: center;
    padding: 0.625rem 1rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--muted-foreground);
    border-radius: var(--radius-full);
    text-decoration: none;
    transition: all 0.15s ease;
  }

  :global(.nav-link:hover),
  :global(.nav-link[data-active]) {
    color: var(--primary);
    background-color: var(--primary-subtle);
  }

  :global(.nav-trigger) {
    cursor: pointer;
    border: none;
    background: transparent;
  }

  :global(.nav-trigger[data-state="open"]) {
    color: var(--primary);
    background-color: var(--primary-subtle);
  }

  :global(.nav-trigger[data-state="open"]) .chevron-icon {
    transform: rotate(180deg);
  }

  .chevron-icon {
    width: 0.875rem;
    height: 0.875rem;
    margin-left: 0.375rem;
    transition: transform 0.2s ease;
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
    margin-top: 0.75rem;
    width: var(--bits-navigation-menu-viewport-width);
    height: var(--bits-navigation-menu-viewport-height);
    overflow: hidden;
    background-color: var(--card);
    border: 3px solid var(--border-sketch);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-lg);
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
    height: 0.75rem;
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
    width: 0.75rem;
    height: 0.75rem;
    transform: rotate(45deg);
    border-top-left-radius: 3px;
    background-color: var(--border-sketch);
  }

  /* Dropdown Content Layout */
  .dropdown-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    padding: 1rem;
    min-width: 380px;
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
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius-lg);
    text-decoration: none;
    transition: all 0.15s ease;
  }

  :global(.category-item:hover),
  :global(.category-item[data-highlighted]) {
    background-color: var(--primary-subtle);
  }

  .category-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-md);
    background: var(--primary-subtle);
    color: var(--primary);
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  :global(.category-item:hover) .category-icon {
    background: var(--primary);
    color: var(--primary-foreground);
    transform: scale(1.1) rotate(5deg);
  }

  .category-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
    line-height: 1.25;
  }

  :global(.category-item:hover) .category-name {
    color: var(--primary);
  }

  .dropdown-footer {
    padding: 0.75rem 1rem;
    border-top: 2px solid var(--border);
    background-color: var(--bg-muted);
  }

  :global(.view-all-link) {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--primary);
    text-decoration: none;
    text-align: center;
    transition: transform 0.2s ease;
  }

  :global(.view-all-link:hover) {
    transform: translateX(4px);
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
    border: 2px solid var(--border);
    background: var(--card);
    color: var(--foreground);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mobile-menu-btn:hover {
    border-color: var(--primary);
    color: var(--primary);
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
    border-top: 2px solid var(--border);
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
    gap: 0.25rem;
  }

  .mobile-link {
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius-lg);
    color: var(--muted-foreground);
    font-weight: 600;
    text-decoration: none;
    transition: all 0.15s ease;
  }

  .mobile-link:hover {
    color: var(--primary);
    background-color: var(--primary-subtle);
  }
</style>
