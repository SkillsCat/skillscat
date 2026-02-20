<script lang="ts">
  import { onMount } from 'svelte';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
    Search01Icon,
    Cancel01Icon,
    StarIcon,
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

  interface Props {
    value?: string;
    placeholder?: string;
    onSearch?: (query: string) => void;
    onSelectSkill?: (skill: SkillSuggestion) => void;
    class?: string;
    showSuggestions?: boolean;
    suggestionMode?: 'categories' | 'skills';
  }

  interface SkillSuggestion {
    id: string;
    name: string;
    slug: string;
    repoOwner: string;
    repoName: string;
    description: string | null;
    stars: number;
    authorAvatar?: string | null;
  }

  interface SearchApiSkill {
    id?: string;
    name?: string;
    slug?: string;
    repoOwner?: string;
    repoName?: string;
    description?: string | null;
    stars?: number;
    authorAvatar?: string | null;
  }

  let {
    value = $bindable(''),
    placeholder = 'Search skills...',
    onSearch,
    onSelectSkill,
    class: className = '',
    showSuggestions = true,
    suggestionMode = 'categories'
  }: Props = $props();

  let isFocused = $state(false);
  let inputElement: HTMLInputElement;
  let skillSuggestions = $state<SkillSuggestion[]>([]);
  let suggestionLimit = $state(5);

  const MOBILE_SUGGESTION_LIMIT = 4;
  const DESKTOP_LIMIT_SHORT = 6;
  const DESKTOP_LIMIT_MEDIUM = 7;
  const DESKTOP_LIMIT_TALL = 8;

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
    };

    updateSuggestionLimit();
    window.addEventListener('resize', updateSuggestionLimit);

    return () => {
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
      .filter(cat =>
        cat.name.toLowerCase().includes(query) ||
        cat.slug.toLowerCase().includes(query)
      )
      .slice(0, suggestionLimit);
  });

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
    const controller = new AbortController();
    let disposed = false;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${suggestionLimit}`, {
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
        skillSuggestions = skills
          .filter((skill): skill is SearchApiSkill & { slug: string; name: string } => Boolean(skill?.slug && skill?.name))
          .map((skill) => ({
            id: skill.id || skill.slug,
            name: skill.name,
            slug: skill.slug,
            repoOwner: skill.repoOwner || '',
            repoName: skill.repoName || '',
            description: skill.description || null,
            stars: Number(skill.stars || 0),
            authorAvatar: skill.authorAvatar || undefined
          }));
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError') {
          skillSuggestions = [];
        }
      }
    }, 160);

    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    isFocused = false;
    onSearch?.(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      isFocused = false;
      onSearch?.(value);
    } else if (e.key === 'Escape') {
      isFocused = false;
      inputElement?.blur();
    }
  }

  function selectCategorySuggestion(categoryName: string) {
    value = categoryName;
    isFocused = false;
    onSearch?.(value);
  }

  function selectSkillSuggestion(skill: SkillSuggestion) {
    value = skill.name;
    isFocused = false;

    if (onSelectSkill) {
      onSelectSkill(skill);
      return;
    }

    onSearch?.(skill.name);
  }

  function clearSearch() {
    value = '';
    inputElement?.focus();
  }

  function formatStars(stars: number): string {
    if (stars >= 1000) {
      return `${(stars / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return String(stars);
  }
</script>

<form onsubmit={handleSubmit} class="search-form {className}">
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
      {placeholder}
      class="search-input"
      autocomplete="off"
    />

    {#if value}
      <button
        type="button"
        onclick={clearSearch}
        class="clear-btn"
        aria-label="Clear search"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2.5} />
      </button>
    {/if}
  </div>

  <!-- Suggestions Dropdown -->
  {#if suggestionMode === 'skills' ? skillSuggestions.length > 0 : categorySuggestions().length > 0}
    <div class="suggestions-dropdown">
      <div class="suggestions-list">
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
                    by {skill.repoOwner}{skill.repoName ? `/${skill.repoName}` : ''}
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
              onclick={() => selectCategorySuggestion(category.name)}
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
    right: 0;
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
