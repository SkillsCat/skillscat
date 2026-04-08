<script lang="ts">
  import { signOut } from '$lib/auth-client';
  import Logo from '$lib/components/common/Logo.svelte';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import DeferredNavbarCategoriesMenu from '$lib/components/layout/DeferredNavbarCategoriesMenu.svelte';
  import DeferredSearchBox from '$lib/components/layout/DeferredSearchBox.svelte';
  import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
  import UserMenu from '$lib/components/common/UserMenu.svelte';
  import { buildSkillPath } from '$lib/skill-path';
  import { useI18n } from '$lib/i18n/runtime';
  import type { CurrentUser } from '$lib/types';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { slide } from 'svelte/transition';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
    Menu01Icon,
    Cancel01Icon,
    Add01Icon,
    CodeIcon,
    FileScriptIcon,
    Settings01Icon,
    Folder01Icon,
    SparklesIcon,
    Mail01Icon,
    Bookmark02Icon,
    Logout01Icon,
    Login03Icon,
  } from '@hugeicons/core-free-icons';

  interface Props {
    currentUser?: CurrentUser | null;
    unreadCount?: number;
    authPending?: boolean;
  }

  let { currentUser = null, unreadCount = 0, authPending = false }: Props = $props();

  let mobileMenuOpen = $state(false);
  let searchQuery = $state('');
  let categoriesMenuValue = $state('');
  let showSubmitDialog = $state(false);
  let showLoginDialog = $state(false);
  let SubmitDialogComponent = $state<typeof import('$lib/components/dialog/SubmitDialog.svelte').default | null>(null);
  let LoginDialogComponent = $state<typeof import('$lib/components/dialog/LoginDialog.svelte').default | null>(null);

  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  // Close mobile menu on navigation
  $effect(() => {
    $page.url.pathname;
    mobileMenuOpen = false;
  });

  async function handleSignOut() {
    mobileMenuOpen = false;
    await signOut();
    await goto('/', { invalidateAll: true });
  }

  function handleSearch(query: string) {
    if (query.trim()) {
      goto(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  function handleSkillSuggestionSelect(skill: { slug: string }) {
    mobileMenuOpen = false;
    goto(buildSkillPath(skill.slug));
  }

  async function openSubmitDialog() {
    if (!SubmitDialogComponent) {
      try {
        const module = await import('$lib/components/dialog/SubmitDialog.svelte');
        SubmitDialogComponent = module.default;
      } catch (error) {
        console.error('Failed to load submit dialog:', error);
        return;
      }
    }

    showSubmitDialog = true;
  }

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

  function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen;
  }

  function matchesPath(basePath: string) {
    return $page.url.pathname === basePath || $page.url.pathname.startsWith(`${basePath}/`);
  }

  function matchesCategoryPath() {
    return $page.url.pathname === '/categories' || matchesPath('/category');
  }
</script>

<nav class="navbar">
  <div class="navbar-container">
    <div class="navbar-inner">
      <!-- Logo -->
      <Logo />

      <!-- Search (Desktop) -->
      <div class="search-desktop">
        <DeferredSearchBox
          class="navbar-wide-sug"
          bind:value={searchQuery}
          onSearch={handleSearch}
          onSelectSkill={handleSkillSuggestionSelect}
          placeholder={messages.nav.searchSkills}
        />
      </div>

      <!-- Nav Links (Desktop) -->
      <div class="nav-links">
        <a
          href="/trending"
          class="nav-link"
          data-active={matchesPath('/trending') ? '' : undefined}
        >
          {messages.nav.trending}
        </a>

        <DeferredNavbarCategoriesMenu
          label={messages.nav.categories}
          bind:value={categoriesMenuValue}
          active={matchesCategoryPath()}
        />

        <a
          href="/docs"
          class="nav-link"
          data-active={matchesPath('/docs') ? '' : undefined}
        >
          {messages.nav.docs}
        </a>
      </div>

      <!-- Right Side -->
      <div class="navbar-right">
        <div class="desktop-controls">
          {#if currentUser}
            <button
              type="button"
              class="nav-submit-btn"
              onclick={() => void openSubmitDialog()}
            >
              <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2} />
              <span class="submit-btn-text">{messages.nav.submit}</span>
            </button>
          {/if}
          <ThemeToggle />
          <UserMenu {currentUser} {unreadCount} authPending={authPending} />
        </div>

        <!-- Mobile Menu Button -->
        <button
          class="mobile-menu-btn"
          onclick={toggleMobileMenu}
          aria-label={messages.nav.toggleMenu}
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
      <div class="mobile-menu" transition:slide={{ duration: 200 }}>
        <!-- Search -->
        <div class="mobile-search">
          <DeferredSearchBox
            class="navbar-wide-sug"
            bind:value={searchQuery}
            onSearch={handleSearch}
            onSelectSkill={handleSkillSuggestionSelect}
            placeholder={messages.nav.searchSkills}
          />
        </div>

        <!-- User Profile Section (logged in only) -->
        {#if currentUser}
          <div class="mobile-user-section">
            <div class="mobile-user-info">
              <Avatar
                src={currentUser.image}
                alt={currentUser.name || messages.userMenu.userAlt}
                fallback={currentUser.name}
                size="sm"
                useGithubFallback
              />
              <div>
                <div class="mobile-user-name">{currentUser.name}</div>
                <div class="mobile-user-email">{currentUser.email}</div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Submit (logged in only) + Nav Links -->
        <div class="mobile-links">
          {#if currentUser}
            <button
              class="mobile-link"
              onclick={async () => {
                mobileMenuOpen = false;
                await openSubmitDialog();
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2} />
              {messages.submitDialog.title}
            </button>
          {/if}
          <a
            href="/trending"
            class="mobile-link"
            data-active={matchesPath('/trending') ? '' : undefined}
            onclick={() => mobileMenuOpen = false}
          >
            <HugeiconsIcon icon={SparklesIcon} size={16} strokeWidth={2} />
            {messages.nav.trending}
          </a>
          <a
            href="/categories"
            class="mobile-link"
            data-active={matchesCategoryPath() ? '' : undefined}
            onclick={() => mobileMenuOpen = false}
          >
            <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={2} />
            {messages.nav.categories}
          </a>
          <a
            href="/docs"
            class="mobile-link"
            data-active={matchesPath('/docs') ? '' : undefined}
            onclick={() => mobileMenuOpen = false}
          >
            <HugeiconsIcon icon={FileScriptIcon} size={16} strokeWidth={2} />
            {messages.nav.docs}
          </a>
        </div>

        <!-- User Links (logged in only) -->
        {#if currentUser}
          <div class="mobile-separator"></div>
          <div class="mobile-links">
            <a href="/user/skills" class="mobile-link" onclick={() => mobileMenuOpen = false}>
              <HugeiconsIcon icon={CodeIcon} size={16} strokeWidth={2} />
              {messages.userMenu.mySkills}
            </a>
            <a href="/user/messages" class="mobile-link" onclick={() => mobileMenuOpen = false}>
              <HugeiconsIcon icon={Mail01Icon} size={16} strokeWidth={2} />
              {messages.userMenu.messages}
              {#if unreadCount > 0}
                <span class="mobile-badge">{unreadCount}</span>
              {/if}
            </a>
            <a href="/bookmarks" class="mobile-link" onclick={() => mobileMenuOpen = false}>
              <HugeiconsIcon icon={Bookmark02Icon} size={16} strokeWidth={2} />
              {messages.userMenu.bookmarks}
            </a>
            <a href="/user/account" class="mobile-link" onclick={() => mobileMenuOpen = false}>
              <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={2} />
              {messages.userMenu.settings}
            </a>
          </div>

          <div class="mobile-separator"></div>
          <div class="mobile-links">
            <button class="mobile-link mobile-link-danger" onclick={handleSignOut}>
              <HugeiconsIcon icon={Logout01Icon} size={16} strokeWidth={2} />
              {messages.userMenu.signOut}
            </button>
          </div>
        {:else if authPending}
          <div class="mobile-sign-in-wrap">
            <div class="mobile-sign-in-placeholder" aria-hidden="true"></div>
          </div>
        {:else}
          <div class="mobile-sign-in-wrap">
            <button
              class="mobile-sign-in-btn"
              onclick={() => {
                mobileMenuOpen = false;
                void openLoginDialog();
              }}
            >
              <HugeiconsIcon icon={Login03Icon} size={16} strokeWidth={2} />
              {messages.auth.continueWithGithub}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</nav>

{#if SubmitDialogComponent}
  <SubmitDialogComponent
    isOpen={showSubmitDialog}
    onClose={() => showSubmitDialog = false}
  />
{/if}

{#if LoginDialogComponent}
  <LoginDialogComponent
    isOpen={showLoginDialog}
    onClose={() => showLoginDialog = false}
  />
{/if}

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
      display: flex;
      align-items: center;
      gap: 0.5rem;
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

  :global(.nav-trigger[data-state="open"] .nav-link-chevron) {
    transform: rotate(180deg);
  }

  :global(.nav-link-chevron) {
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
    width: min(var(--bits-navigation-menu-viewport-width), calc(100vw - 1rem));
    max-width: calc(100vw - 1rem);
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

  :global(.nav-indicator-arrow) {
    position: relative;
    top: 70%;
    width: 0.75rem;
    height: 0.75rem;
    transform: rotate(45deg);
    border-top-left-radius: 3px;
    background-color: var(--border-sketch);
  }

  /* Right Side */
  .navbar-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .desktop-controls {
    display: none;
    align-items: center;
    gap: 0.75rem;
  }

  @media (min-width: 768px) {
    .desktop-controls {
      display: flex;
    }
  }

  .submit-btn-text {
    display: none;
  }

  @media (min-width: 640px) {
    .submit-btn-text {
      display: inline;
    }
  }

  .nav-submit-btn {
    --btn-shadow-offset: 3px;
    --btn-shadow-color: oklch(50% 0.22 55);

    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.875rem;
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

  .nav-submit-btn:hover {
    --btn-shadow-offset: 5px;
    background-color: var(--primary-hover);
    transform: translateY(-2px);
  }

  .nav-submit-btn:active {
    --btn-shadow-offset: 1px;
    transform: translateY(2px);
  }

  :global(.dark) .nav-submit-btn {
    --btn-shadow-color: oklch(40% 0.20 55);
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
    display: flex;
    flex-direction: column;
    padding: 0.75rem 0;
    border-top: 2px solid var(--border);
    max-height: calc(100dvh - 4.5rem);
    overflow-y: auto;
  }

  @media (min-width: 768px) {
    .mobile-menu {
      display: none;
    }
  }

  .mobile-user-section {
    padding: 0.25rem 0 0.5rem;
  }

  .mobile-user-info {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem 1rem;
  }

  .mobile-user-name {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .mobile-user-email {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .mobile-sign-in-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.625rem 1rem;
    min-height: 40px;
    font-size: 0.875rem;
    font-weight: 600;
    color: #fff;
    background: var(--primary);
    border: 2px solid var(--primary);
    border-radius: var(--radius-full);
    box-shadow: 0 4px 0 0 oklch(50% 0.22 55);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mobile-sign-in-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 0 oklch(50% 0.22 55);
  }

  .mobile-sign-in-btn:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 0 oklch(50% 0.22 55);
  }

  .mobile-sign-in-wrap {
    margin-top: auto;
    padding: 0.5rem 1rem 0;
  }

  .mobile-sign-in-placeholder {
    height: 2.75rem;
    border-radius: var(--radius-full);
    background:
      linear-gradient(
        90deg,
        color-mix(in oklch, var(--fg) 6%, transparent) 0%,
        color-mix(in oklch, var(--fg) 10%, transparent) 50%,
        color-mix(in oklch, var(--fg) 6%, transparent) 100%
      );
    background-size: 200% 100%;
    animation: navbar-auth-placeholder 1.4s linear infinite;
  }

  .mobile-separator {
    height: 0;
    border-top: 2px solid var(--border);
    margin: 0.375rem 0;
  }

  .mobile-search {
    margin-bottom: 0.5rem;
  }

  .mobile-links {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .mobile-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    min-height: 40px;
    border: none;
    background: transparent;
    border-radius: var(--radius-lg);
    color: var(--muted-foreground);
    font-weight: 600;
    font-size: 0.875rem;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mobile-link:hover,
  .mobile-link[data-active] {
    color: var(--primary);
    background-color: var(--primary-subtle);
  }

  .mobile-link-danger {
    color: oklch(55% 0.20 25);
  }

  .mobile-link-danger:hover {
    color: oklch(45% 0.20 25);
    background-color: oklch(95% 0.02 25);
  }

  .mobile-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0 0.3rem;
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--primary-foreground);
    background: var(--primary);
    border-radius: var(--radius-full);
    margin-left: auto;
  }

  @keyframes navbar-auth-placeholder {
    from {
      background-position: 200% 0;
    }

    to {
      background-position: -200% 0;
    }
  }
</style>
