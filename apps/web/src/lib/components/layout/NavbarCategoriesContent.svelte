<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { getLocalizedCategorySections } from '$lib/i18n/categories';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
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
    MoneyBag01Icon,
    BitcoinIcon,
    JusticeScale01Icon,
    MortarboardIcon,
    GameboyIcon,
    Calculator01Icon
  } from '@hugeicons/core-free-icons';

  type MenuDensity = 'compact' | 'comfortable' | 'full';

  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  let windowWidth = $state(1440);

  const categoryIcons: Record<string, typeof GitBranchIcon> = {
    'code-generation': CodeIcon,
    'refactoring': RefreshIcon,
    'debugging': Bug01Icon,
    'testing': TestTubeIcon,
    'code-review': EyeIcon,
    'git': GitBranchIcon,
    'api': Link01Icon,
    'database': Database01Icon,
    'auth': LockPasswordIcon,
    'caching': Loading01Icon,
    design: PaintBrush01Icon,
    'ui-components': PaintBrush01Icon,
    'accessibility': AccessIcon,
    'animation': SparklesIcon,
    'responsive': SmartPhone01Icon,
    'ci-cd': FlowIcon,
    'docker': CubeIcon,
    'kubernetes': Settings01Icon,
    'cloud': CloudIcon,
    'monitoring': Activity01Icon,
    'security': SecurityLockIcon,
    'performance': SpeedTrain01Icon,
    'linting': CheckListIcon,
    'types': DocumentCodeIcon,
    'documentation': FileScriptIcon,
    'comments': MessageIcon,
    'i18n': EarthIcon,
    'data-processing': DatabaseExportIcon,
    'analytics': Analytics01Icon,
    'scraping': Search01Icon,
    'math': Calculator01Icon,
    'prompts': AiChat01Icon,
    'embeddings': AiBrain01Icon,
    'agents': AiGenerativeIcon,
    'ml-ops': AiGenerativeIcon,
    'automation': WorkflowSquare01Icon,
    'file-ops': Folder01Icon,
    'cli': ConsoleIcon,
    'templates': LayoutIcon,
    'writing': Edit01Icon,
    'email': Mail01Icon,
    'social': Share01Icon,
    'seo': Search01Icon,
    'finance': MoneyBag01Icon,
    'web3-crypto': BitcoinIcon,
    'legal': JusticeScale01Icon,
    'academic': MortarboardIcon,
    'game-dev': GameboyIcon
  };

  const sectionIdsByDensity: Record<MenuDensity, readonly string[]> = {
    compact: ['development', 'backend', 'frontend', 'devops'],
    comfortable: ['development', 'backend', 'frontend', 'devops', 'quality'],
    full: ['development', 'backend', 'frontend', 'devops', 'quality', 'lifestyle'],
  };

  const menuDensity = $derived.by<MenuDensity>(() => {
    if (windowWidth < 1200) return 'compact';
    if (windowWidth < 1440) return 'comfortable';
    return 'full';
  });

  const displaySections = $derived.by(() => {
    const allowedSectionIds = new Set(sectionIdsByDensity[menuDensity]);
    return getLocalizedCategorySections(i18n.locale()).filter((section) =>
      allowedSectionIds.has(section.id)
    );
  });
</script>

<svelte:window bind:innerWidth={windowWidth} />

<div class="dropdown-sections" data-density={menuDensity}>
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
<div class="dropdown-footer" data-density={menuDensity}>
  <NavigationMenu.Link href="/categories" class="view-all-link">
    {messages.categories.viewAll}
  </NavigationMenu.Link>
</div>

<style>
  .dropdown-sections {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.35rem;
    padding: 1rem;
    width: min(calc(100vw - 2rem), 30rem);
  }

  .dropdown-sections[data-density='compact'] {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.25rem;
    padding: 0.8rem 0.85rem 0.7rem;
    width: min(calc(100vw - 2rem), 56rem);
  }

  .dropdown-sections[data-density='comfortable'] {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    width: min(calc(100vw - 2.75rem), 60rem);
  }

  .dropdown-sections[data-density='full'] {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    width: min(calc(100vw - 3.5rem), 68rem);
  }

  @media (max-width: 1023px) {
    .dropdown-sections[data-density='compact'],
    .dropdown-sections[data-density='comfortable'],
    .dropdown-sections[data-density='full'] {
      width: min(calc(100vw - 1.5rem), 50rem);
    }
  }

  .section-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .dropdown-sections[data-density='compact'] .section-group {
    gap: 0.15rem;
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

  .dropdown-sections[data-density='compact'] .section-title {
    padding: 0.2rem 0.35rem;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
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

  .dropdown-sections[data-density='compact'] :global(.category-item) {
    gap: 0.4rem;
    padding: 0.28rem 0.35rem;
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

  .dropdown-sections[data-density='compact'] .category-icon {
    width: 1.3rem;
    height: 1.3rem;
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

  .dropdown-sections[data-density='compact'] .category-name {
    font-size: 0.76rem;
    line-height: 1.15;
  }

  :global(.category-item:hover) .category-name {
    color: var(--primary);
  }

  .dropdown-footer {
    box-sizing: border-box;
    padding: 0.75rem 1rem;
    border-top: 2px solid var(--border);
    background-color: var(--bg-muted);
  }

  .dropdown-footer[data-density='compact'] {
    padding: 0.55rem 0.85rem 0.65rem;
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
</style>
