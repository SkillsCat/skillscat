<script lang="ts">
  import { onMount } from 'svelte';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
  import { localizeCategory } from '$lib/i18n/categories';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
    Search01Icon,
    Cancel01Icon,
    StarIcon,
    Delete02Icon,
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
  import { CATEGORIES } from '$lib/constants';
  import {
    addSearchHistoryEntry,
    filterSearchHistory,
    loadSearchHistory,
    saveSearchHistory
  } from '$lib/search-history';

  interface Props {
    value?: string;
    placeholder?: string;
    onSearch?: (query: string) => void;
    onSelectSkill?: (skill: SkillSuggestion) => void;
    onSelectCategory?: (category: { slug: string; name: string }) => void;
    class?: string;
    showSuggestions?: boolean;
    suggestionMode?: 'categories' | 'skills';
    showHistory?: boolean;
    suggestionCategory?: string;
    autofocus?: boolean;
  }

  interface SkillSuggestion {
    id: string;
    name: string;
    slug: string;
    repoOwner: string;
    repoName: string;
    stars: number;
    authorAvatar?: string | null;
  }

  interface SearchApiSkill {
    id?: string;
    name?: string;
    slug?: string;
    repoOwner?: string;
    repoName?: string;
    stars?: number;
    authorAvatar?: string | null;
  }

  interface SuggestionCacheEntry {
    skills: SkillSuggestion[];
    expiresAt: number;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    onSearch,
    onSelectSkill,
    onSelectCategory,
    class: className = '',
    showSuggestions = true,
    suggestionMode = 'categories',
    showHistory = true,
    suggestionCategory = '',
    autofocus = false
  }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const effectivePlaceholder = $derived(placeholder || messages.nav.searchSkills);

  let isFocused = $state(false);
  let searchFormEl: HTMLFormElement;
  let inputElement: HTMLInputElement;
  let skillSuggestions = $state<SkillSuggestion[]>([]);
  let suggestionLimit = $state(5);
  let suggestionsDropdownInlineStyle = $state('');
  let suggestionsLayoutFrame = 0;

  const MOBILE_SUGGESTION_LIMIT = 4;
  const DESKTOP_LIMIT_SHORT = 6;
  const DESKTOP_LIMIT_MEDIUM = 7;
  const DESKTOP_LIMIT_TALL = 8;
  const SUGGESTION_FETCH_DEBOUNCE_MS = 160;
  const CLIENT_SUGGESTION_CACHE_TTL_MS = 45_000;
  const CLIENT_SUGGESTION_CACHE_MAX_ENTRIES = 80;
  const NAVBAR_WIDE_SUG_CLASS = 'navbar-wide-sug';
  const DESKTOP_SUG_EXTRA_WIDTH = 24;
  const MOBILE_SUG_EXTRA_WIDTH = 12;
  const DESKTOP_SUG_VIEWPORT_GAP = 16;
  const MOBILE_SUG_VIEWPORT_GAP = 8;

  const enableWideNavbarSuggestions = $derived(
    className
      .split(/\s+/)
      .filter(Boolean)
      .includes(NAVBAR_WIDE_SUG_CLASS)
  );

  const suggestionCache = new Map<string, SuggestionCacheEntry>();
  let queryHistory = $state<string[]>([]);
  let showClearHistoryDialog = $state(false);

  function addQueryToHistory(query: string) {
    if (!showHistory) return;

    const nextEntries = addSearchHistoryEntry(queryHistory, query);
    if (nextEntries === queryHistory) return;

    queryHistory = nextEntries;
    saveSearchHistory(nextEntries);
  }

  const visibleQueryHistory = $derived(() => {
    if (!showHistory || !isFocused || !showSuggestions) return [];
    return filterSearchHistory(queryHistory, value);
  });

  function getSuggestionLimit(): number {
    if (typeof window === 'undefined') return 5;

    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    if (!isDesktop) {
      return MOBILE_SUGGESTION_LIMIT;
    }

    const viewportHeight = window.innerHeight;
    if (viewportHeight >= 1000) return DESKTOP_LIMIT_TALL;
    if (viewportHeight >= 820) return DESKTOP_LIMIT_MEDIUM;
    return DESKTOP_LIMIT_SHORT;
  }

  onMount(() => {
    const updateSuggestionLimit = () => {
      suggestionLimit = getSuggestionLimit();
      scheduleSuggestionsDropdownLayout();
    };

    updateSuggestionLimit();
    if (showHistory) {
      queryHistory = loadSearchHistory();
    }

    if (autofocus) {
      requestAnimationFrame(() => {
        inputElement?.focus();
        if (inputElement) {
          const end = inputElement.value.length;
          inputElement.setSelectionRange(end, end);
        }
        isFocused = true;
      });
    }

    window.addEventListener('resize', updateSuggestionLimit);

    return () => {
      if (suggestionsLayoutFrame) cancelAnimationFrame(suggestionsLayoutFrame);
      window.removeEventListener('resize', updateSuggestionLimit);
    };
  });

  // Icon mapping for categories
  const categoryIcons: Record<string, typeof GitBranchIcon> = {
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
    design: PaintBrush01Icon,
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'devops': Settings01Icon,
    'monitoring': Activity01Icon,
    'file-operations': Folder01Icon,
    'automation': WorkflowSquare01Icon,
    'productivity': SparklesIcon
  };

  // Filter category suggestions based on input
  const categorySuggestions = $derived(() => {
    if (!value.trim() || !isFocused || !showSuggestions) return [];

    const query = value.toLowerCase();
    return CATEGORIES
      .map((category) => localizeCategory(category, i18n.locale()))
      .filter(cat =>
        cat.name.toLowerCase().includes(query) ||
        cat.slug.toLowerCase().includes(query)
      )
      .slice(0, suggestionLimit);
  });

  const hasSuggestionItems = $derived(() => (
    suggestionMode === 'skills'
      ? skillSuggestions.length > 0
      : categorySuggestions().length > 0
  ));

  const hasDropdownItems = $derived(() => (
    hasSuggestionItems() || visibleQueryHistory().length > 0
  ));

  // Fetch skill suggestions from the database-backed search API.
  $effect(() => {
    if (suggestionMode !== 'skills') {
      skillSuggestions = [];
      return;
    }

    const query = value.trim();
    if (!query || query.length < 2 || !isFocused || !showSuggestions) {
      skillSuggestions = [];
      return;
    }

    const requestQuery = query.toLowerCase();
    const categoryScope = suggestionCategory.trim().toLowerCase();
    const cacheKey = `${requestQuery}:${suggestionLimit}:${categoryScope || '_'}`;
    const cached = suggestionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      skillSuggestions = cached.skills;
      return;
    }

    if (cached) {
      suggestionCache.delete(cacheKey);
    }

    const controller = new AbortController();
    let disposed = false;

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query,
          limit: String(suggestionLimit)
        });
        if (categoryScope) {
          params.set('category', categoryScope);
        }

        const response = await fetch(`/api/search?${params.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok) return;

        const payload = await response.json() as {
          data?: {
            skills?: SearchApiSkill[];
          };
        };
        if (disposed || value.trim().toLowerCase() !== requestQuery) return;

        const skills = Array.isArray(payload?.data?.skills) ? payload.data.skills : [];
        const normalizedSkills = skills
          .filter((skill): skill is SearchApiSkill & { slug: string; name: string } => Boolean(skill?.slug && skill?.name))
          .map((skill) => ({
            id: skill.id || skill.slug,
            name: skill.name,
            slug: skill.slug,
            repoOwner: skill.repoOwner || '',
            repoName: skill.repoName || '',
            stars: Number(skill.stars || 0),
            authorAvatar: skill.authorAvatar || undefined
          }));

        skillSuggestions = normalizedSkills;
        suggestionCache.set(cacheKey, {
          skills: normalizedSkills,
          expiresAt: Date.now() + CLIENT_SUGGESTION_CACHE_TTL_MS
        });

        if (suggestionCache.size > CLIENT_SUGGESTION_CACHE_MAX_ENTRIES) {
          const oldestKey = suggestionCache.keys().next().value;
          if (oldestKey) suggestionCache.delete(oldestKey);
        }
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError') {
          skillSuggestions = [];
        }
      }
    }, SUGGESTION_FETCH_DEBOUNCE_MS);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    isFocused = false;
    addQueryToHistory(value);
    onSearch?.(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      isFocused = false;
      addQueryToHistory(value);
      onSearch?.(value);
    } else if (e.key === 'Escape') {
      isFocused = false;
      inputElement?.blur();
    }
  }

  function selectCategorySuggestion(category: { slug: string; name: string }) {
    isFocused = false;
    addQueryToHistory(category.name);
    value = category.name;
    onSelectCategory?.(category);
    onSearch?.(category.name);
  }

  function selectSkillSuggestion(skill: SkillSuggestion) {
    isFocused = false;
    addQueryToHistory(skill.name);
    value = skill.name;

    if (onSelectSkill) {
      onSelectSkill(skill);
      return;
    }

    onSearch?.(skill.name);
  }

  function selectHistoryQuery(query: string) {
    isFocused = false;
    addQueryToHistory(query);
    value = query;
    onSearch?.(query);
  }

  function clearQueryHistory() {
    queryHistory = [];
    saveSearchHistory([]);
    showClearHistoryDialog = false;
  }

  function clearSearch() {
    value = '';
    inputElement?.focus();
  }

  function updateSuggestionsDropdownLayout() {
    if (typeof window === 'undefined' || !enableWideNavbarSuggestions || !searchFormEl) {
      suggestionsDropdownInlineStyle = '';
      return;
    }

    const rect = searchFormEl.getBoundingClientRect();
    if (!rect.width) {
      suggestionsDropdownInlineStyle = '';
      return;
    }

    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    const viewportGap = isDesktop ? DESKTOP_SUG_VIEWPORT_GAP : MOBILE_SUG_VIEWPORT_GAP;
    const extraWidth = isDesktop ? DESKTOP_SUG_EXTRA_WIDTH : MOBILE_SUG_EXTRA_WIDTH;
    const maxWidth = Math.max(0, window.innerWidth - viewportGap * 2);
    const width = Math.min(rect.width + extraWidth, maxWidth);

    if (width <= 0) {
      suggestionsDropdownInlineStyle = '';
      return;
    }

    const idealLeft = rect.left - (width - rect.width) / 2;
    const minLeft = viewportGap;
    const maxLeft = Math.max(viewportGap, window.innerWidth - viewportGap - width);
    const clampedLeft = Math.min(Math.max(idealLeft, minLeft), maxLeft);
    const leftOffset = clampedLeft - rect.left;

    suggestionsDropdownInlineStyle = `left: ${leftOffset}px; width: ${width}px; right: auto;`;
  }

  function scheduleSuggestionsDropdownLayout() {
    if (typeof window === 'undefined') return;

    if (suggestionsLayoutFrame) cancelAnimationFrame(suggestionsLayoutFrame);
    suggestionsLayoutFrame = requestAnimationFrame(() => {
      suggestionsLayoutFrame = 0;
      updateSuggestionsDropdownLayout();
    });
  }

  function formatStars(stars: number): string {
    return i18n.formatCompactNumber(stars);
  }

  $effect(() => {
    if (!enableWideNavbarSuggestions) {
      suggestionsDropdownInlineStyle = '';
      return;
    }

    const hasHistory = visibleQueryHistory().length > 0;
    const hasSuggestions = hasSuggestionItems();

    isFocused;
    value;

    if ((!hasHistory && !hasSuggestions) || !isFocused) {
      suggestionsDropdownInlineStyle = '';
      return;
    }

    scheduleSuggestionsDropdownLayout();
  });
</script>

<form bind:this={searchFormEl} onsubmit={handleSubmit} class="search-form {className}">
  <!-- Search Input -->
  <div class="search-input-wrapper">
    <div class="search-icon">
      <HugeiconsIcon icon={Search01Icon} size={18} strokeWidth={2} />
    </div>

    <input
      bind:this={inputElement}
      type="search"
      bind:value
      onkeydown={handleKeydown}
      onfocus={() => { isFocused = true; }}
      onblur={() => { setTimeout(() => { isFocused = false; }, 200); }}
      placeholder={effectivePlaceholder}
      class="search-input"
      autocomplete="off"
    />

    {#if value}
      <button
        type="button"
        onclick={clearSearch}
        class="clear-btn"
        aria-label={messages.searchBox.clearSearch}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2.5} />
      </button>
    {/if}
  </div>

  <!-- Suggestions Dropdown -->
  {#if hasDropdownItems()}
    <div class="suggestions-dropdown" style={suggestionsDropdownInlineStyle}>
      <div class="suggestions-list">
        {#if visibleQueryHistory().length > 0}
          <div class="history-header">
            <span class="history-title">{messages.searchBox.recentSearches}</span>
            <button
              type="button"
              class="history-clear-btn"
              aria-label={messages.searchBox.clearSearchHistory}
              onclick={() => showClearHistoryDialog = true}
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={2.25} />
            </button>
          </div>

          <div class="history-chips">
            {#each visibleQueryHistory() as historyQuery (historyQuery)}
              <button
                type="button"
                onclick={() => selectHistoryQuery(historyQuery)}
                class="history-chip"
              >
                {historyQuery}
              </button>
            {/each}
          </div>

          {#if hasSuggestionItems()}
            <div class="suggestions-divider"></div>
          {/if}
        {/if}

        {#if suggestionMode === 'skills'}
          {#each skillSuggestions as skill (skill.id)}
            <button
              type="button"
              onclick={() => selectSkillSuggestion(skill)}
              class="suggestion-item"
            >
              <span class="suggestion-avatar">
                <Avatar
                  src={skill.authorAvatar}
                  fallback={skill.repoOwner || skill.name}
                  alt={skill.repoOwner || skill.name}
                  size="sm"
                  shape="circle"
                  useGithubFallback
                />
              </span>
              <span class="suggestion-content">
                <span class="suggestion-name">{skill.name}</span>
                <span class="suggestion-meta-row">
                  <span class="suggestion-author">
                    {i18n.t(messages.searchBox.suggestionByRepo, {
                      owner: skill.repoOwner,
                      repo: skill.repoName ? `/${skill.repoName}` : '',
                    })}
                  </span>
                  <span class="suggestion-stars">
                    <HugeiconsIcon icon={StarIcon} size={12} strokeWidth={2} />
                    {formatStars(skill.stars)}
                  </span>
                </span>
              </span>
            </button>
          {/each}
        {:else}
          {#each categorySuggestions() as category (category.slug)}
            <button
              type="button"
              onclick={() => selectCategorySuggestion(category)}
              class="suggestion-item"
            >
              <span class="suggestion-icon">
                <HugeiconsIcon icon={categoryIcons[category.slug]} size={18} strokeWidth={2} />
              </span>
              <span class="suggestion-name">
                {category.name}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</form>

<ConfirmDialog
  open={showClearHistoryDialog}
  title={messages.searchBox.clearSearchHistory}
  description={messages.searchBox.clearSearchHistoryDescription}
  confirmText={messages.searchBox.clearAll}
  cancelText={messages.common.cancel}
  onConfirm={clearQueryHistory}
  onCancel={() => showClearHistoryDialog = false}
  danger={true}
/>

<style>
  .search-form {
    position: relative;
  }

  .search-input-wrapper {
    --input-shadow-offset: 3px;
    --input-shadow-color: oklch(75% 0.02 85);

    position: relative;
    display: flex;
    align-items: center;
    box-shadow: 0 var(--input-shadow-offset) 0 0 var(--input-shadow-color);
    border-radius: var(--radius-full);
    transform: translateY(0);
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }

  .search-input-wrapper:focus-within {
    --input-shadow-offset: 1px;
    transform: translateY(2px);
  }

  :global(.dark) .search-input-wrapper {
    --input-shadow-color: oklch(25% 0.02 85);
  }

  .search-icon {
    position: absolute;
    left: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-subtle);
    pointer-events: none;
    z-index: 1;
    display: flex;
    align-items: center;
    transition: color 0.15s ease;
  }

  .search-input-wrapper:focus-within .search-icon {
    color: var(--primary);
  }

  .search-input {
    width: 100%;
    padding: 0.625rem 2.5rem 0.625rem 2.75rem;
    font-size: 0.875rem;
    font-family: var(--font-sans);
    color: var(--foreground);
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    outline: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .search-input[type='search'] {
    appearance: textfield;
  }

  .search-input::-webkit-search-decoration,
  .search-input::-webkit-search-cancel-button,
  .search-input::-webkit-search-results-button,
  .search-input::-webkit-search-results-decoration {
    appearance: none;
    -webkit-appearance: none;
    display: none;
  }

  .search-input:focus {
    border-color: var(--primary);
    background: var(--background);
  }

  .search-input::placeholder {
    color: var(--muted-foreground);
  }

  .clear-btn {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0.375rem;
    background: none;
    border: none;
    color: var(--fg-subtle);
    cursor: pointer;
    border-radius: 9999px;
    transition: all 0.15s ease;
  }

  .clear-btn:hover {
    color: var(--fg);
    background: var(--muted);
  }

  .suggestions-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    margin-top: 0.5rem;
    z-index: 50;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .suggestions-list {
    padding: 0.5rem;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem 0.5rem;
  }

  .history-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--fg-subtle);
    text-transform: uppercase;
  }

  .history-clear-btn {
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    color: var(--fg-subtle);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .history-clear-btn:hover {
    color: var(--destructive);
    background: var(--primary-subtle);
  }

  .history-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding: 0 0.5rem 0.25rem;
  }

  .history-chip {
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    min-height: 1.75rem;
    padding: 0.25rem 0.625rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--background);
    color: var(--foreground);
    font-size: 0.75rem;
    line-height: 1;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.15s ease;
  }

  .history-chip:hover {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
  }

  .suggestions-divider {
    height: 1px;
    margin: 0.5rem 0.375rem;
    background: var(--border);
  }

  .suggestion-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    min-height: 44px;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .suggestion-item:hover {
    background: var(--primary-subtle);
  }

  .suggestion-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-md);
    color: var(--primary);
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .suggestion-item:hover .suggestion-icon {
    background: var(--primary);
    color: var(--primary-foreground);
  }

  .suggestion-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--foreground);
  }

  .suggestion-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 0.125rem;
  }

  .suggestion-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .suggestion-meta-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    font-size: 0.75rem;
    color: var(--fg-subtle);
  }

  .suggestion-author {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .suggestion-stars {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .suggestion-item:hover .suggestion-stars {
    color: var(--primary);
  }

  .suggestion-item:hover .suggestion-author {
    color: var(--fg);
  }

  .suggestion-item:hover .suggestion-name {
    color: var(--primary);
  }

</style>
