<script lang="ts">
  import { NavigationMenu } from 'bits-ui';
  import { CATEGORY_SECTIONS } from '$lib/constants/categories';
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

  const categoryIcons: Record<string, any> = {
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

  const displaySections = CATEGORY_SECTIONS.filter((section) =>
    ['development', 'backend', 'frontend', 'devops', 'quality', 'lifestyle'].includes(section.id)
  );
</script>

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

<style>
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
</style>
