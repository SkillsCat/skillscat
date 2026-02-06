<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { Logo, ThemeToggle, SearchBox, UserMenu, SubmitDialog, Button } from '$lib/components';
  import { CATEGORY_SECTIONS } from '$lib/constants/categories';
  import { goto } from '$app/navigation';
  import { useSession } from '$lib/auth-client';
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
    SparklesIcon,
    CloudIcon,
    FlowIcon,
    SmartPhone01Icon,
    AiGenerativeIcon,
    AiBrain01Icon,
    AiChat01Icon,
    Mail01Icon,
    Share01Icon,
    Edit01Icon,
    MessageIcon,
    LockPasswordIcon,
    Loading01Icon,
    Analytics01Icon,
    ConsoleIcon,
    DocumentCodeIcon,
    LayoutIcon,
    CheckListIcon,
    CubeIcon,
    Search01Icon,
    Add01Icon,
    MoneyBag01Icon,
    BitcoinIcon,
    JusticeScale01Icon,
    MortarboardIcon,
    GameboyIcon,
    Calculator01Icon
  } from '@hugeicons/core-free-icons';

  let mobileMenuOpen = $state(false);
  let searchQuery = $state('');
  let showSubmitDialog = $state(false);

  const session = useSession();

  // Icon mapping for categories (by slug)
  const categoryIcons: Record<string, any> = {
    // Development
    'code-generation': CodeIcon,
    'refactoring': RefreshIcon,
    'debugging': Bug01Icon,
    'testing': TestTubeIcon,
    'code-review': EyeIcon,
    'git': GitBranchIcon,
    // Backend
    'api': Link01Icon,
    'database': Database01Icon,
    'auth': LockPasswordIcon,
    'caching': Loading01Icon,
    // Frontend
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'animation': SparklesIcon,
    'responsive': SmartPhone01Icon,
    // DevOps
    'ci-cd': FlowIcon,
    'docker': CubeIcon,
    'kubernetes': Settings01Icon,
    'cloud': CloudIcon,
    'monitoring': Activity01Icon,
    // Quality
    'security': SecurityLockIcon,
    'performance': SpeedTrain01Icon,
    'linting': CheckListIcon,
    'types': DocumentCodeIcon,
    // Docs
    'documentation': FileScriptIcon,
    'comments': MessageIcon,
    'i18n': EarthIcon,
    // Data
    'data-processing': DatabaseExportIcon,
    'analytics': Analytics01Icon,
    'scraping': Search01Icon,
    'math': Calculator01Icon,
    // AI
    'prompts': AiChat01Icon,
    'embeddings': AiBrain01Icon,
    'agents': AiGenerativeIcon,
    'ml-ops': AiGenerativeIcon,
    // Productivity
    'automation': WorkflowSquare01Icon,
    'file-ops': Folder01Icon,
    'cli': ConsoleIcon,
    'templates': LayoutIcon,
    // Content
    'writing': Edit01Icon,
    'email': Mail01Icon,
    'social': Share01Icon,
    'seo': Search01Icon,
    // Lifestyle
    'finance': MoneyBag01Icon,
    'web3-crypto': BitcoinIcon,
    'legal': JusticeScale01Icon,
    'academic': MortarboardIcon,
    'game-dev': GameboyIcon
  };

  function handleSearch(query: string) {
    if (query.trim()) {
      goto(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  // Get sections for dropdown display
  const displaySections = CATEGORY_SECTIONS.filter(s =>
    ['development', 'backend', 'frontend', 'devops', 'quality', 'lifestyle'].includes(s.id)
  );
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

              <NavigationMenu.Content class="nav-content" forceMount>
                <div class="dropdown-sections">
                  {#each displaySections as section}
                    <div class="section-group">
                      <div class="section-title">{section.name}</div>
                      <ul class="category-list">
                        {#each section.categories as category}
                          <li>
                            <NavigationMenu.Link
                              href="/category/{category.slug}"
                              class="category-item"
                            >
                              <div class="category-icon">
                                <HugeiconsIcon icon={categoryIcons[category.slug] || SparklesIcon} size={16} strokeWidth={2} />
                              </div>
                              <div class="category-name">{category.name}</div>
                            </NavigationMenu.Link>
                          </li>
                        {/each}
                      </ul>
                    </div>
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
          <NavigationMenu.Viewport class="nav-viewport" forceMount />
        </NavigationMenu.Root>
      </div>

      <!-- Right Side -->
      <div class="navbar-right">
        {#if $session.data?.user}
          <Button
            variant="cute"
            size="sm"
            onclick={() => showSubmitDialog = true}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2} />
            <span class="submit-btn-text">Submit</span>
          </Button>
        {/if}
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

<SubmitDialog isOpen={showSubmitDialog} onClose={() => showSubmitDialog = false} />

<style>
  .navbar {
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .navbar-container {
    max-width: 80rem;
    margin: 0 auto;
    padding: 0 1rem;
    position: relative;
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
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  :global(.nav-viewport[data-state="open"]) {
    opacity: 1;
    pointer-events: auto;
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

  /* Dropdown Content Layout - Grouped by Sections */
  .dropdown-sections {
    display: grid;
    grid-template-columns: repeat(3, minmax(140px, 1fr));
    gap: 0.25rem;
    padding: 1rem;
    min-width: 450px;
    max-width: 500px;
  }

  @media (min-width: 1024px) {
    .dropdown-sections {
      grid-template-columns: repeat(6, minmax(130px, 1fr));
      min-width: 800px;
      max-width: 900px;
    }
  }

  .section-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .section-title {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted-foreground);
    padding: 0.25rem 0.5rem;
    margin-bottom: 0.125rem;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  :global(.category-item) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-md);
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
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    background: var(--primary-subtle);
    color: var(--primary);
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  :global(.category-item:hover) .category-icon {
    background: var(--primary);
    color: var(--primary-foreground);
    transform: scale(1.1);
  }

  .category-name {
    font-size: 0.8125rem;
    font-weight: 500;
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

  .submit-btn-text {
    display: none;
  }

  @media (min-width: 640px) {
    .submit-btn-text {
      display: inline;
    }
  }

  .mobile-menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.75rem;
    min-width: 44px;
    min-height: 44px;
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
    padding: 0.875rem 1rem;
    min-height: 44px;
    border-radius: var(--radius-lg);
    color: var(--muted-foreground);
    font-weight: 600;
    font-size: 1rem;
    text-decoration: none;
    transition: all 0.15s ease;
  }

  .mobile-link:hover {
    color: var(--primary);
    background-color: var(--primary-subtle);
  }
</style>
