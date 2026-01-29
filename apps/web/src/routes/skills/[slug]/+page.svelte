<script lang="ts">
  import { CopyButton, Button, Section, Grid, SkillCard, SkillCardCompact, EmptyState } from '$lib/components';
  import { getCategoryBySlug } from '$lib/constants/categories';
  import type { SkillDetail, SkillCardData } from '$lib/types';

  interface Props {
    data: {
      skill: SkillDetail | null;
      relatedSkills: SkillCardData[];
      error?: string;
      isOwner?: boolean;
    };
  }

  let { data }: Props = $props();

  // Determine the install identifier based on skill type
  const skillIdentifier = $derived(() => {
    if (!data.skill) return '';
    // For private/uploaded skills, use the slug format (@owner/name)
    if (data.skill.visibility !== 'public' || data.skill.sourceType === 'upload') {
      return data.skill.slug;
    }
    // For public GitHub skills, use owner/repo format
    return `${data.skill.repoOwner}/${data.skill.repoName}`;
  });

  // Installation commands for different CLI tools
  const installCommands = $derived(data.skill ? [
    {
      name: 'skillscat',
      label: 'SkillsCat CLI',
      command: `npx skillscat add ${skillIdentifier()}`,
      description: data.skill.visibility === 'private'
        ? 'Requires authentication. Run `skillscat login` first.'
        : 'SkillsCat registry CLI'
    },
    ...(data.skill.sourceType === 'github' && data.skill.visibility === 'public' ? [{
      name: 'add-skill',
      label: 'Vercel add-skill',
      command: `npx add-skill ${data.skill.repoOwner}/${data.skill.repoName}`,
      description: 'Works with Claude Code, Cursor, Codex, and 10+ agents'
    }] : [])
  ] : []);

  let selectedInstaller = $state('skillscat');
  const currentCommand = $derived(installCommands.find(c => c.name === selectedInstaller)?.command || '');

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
  }

  // Get visibility badge color
  function getVisibilityColor(visibility: string): string {
    switch (visibility) {
      case 'private': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'unlisted': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      default: return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    }
  }
</script>

<svelte:head>
  {#if data.skill}
    <title>{data.skill.name} - SkillsCat</title>
    <meta name="description" content={data.skill.description || `Claude Code skill: ${data.skill.name}`} />
    <meta property="og:title" content="{data.skill.name} - SkillsCat" />
    <meta property="og:description" content={data.skill.description || ''} />
  {:else}
    <title>Skill Not Found - SkillsCat</title>
  {/if}
</svelte:head>

{#if data.skill}
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Breadcrumb -->
    <nav class="mb-6 text-sm">
      <ol class="flex items-center gap-2 text-fg-muted">
        <li><a href="/" class="hover:text-primary transition-colors">Home</a></li>
        <li>/</li>
        <li><a href="/trending" class="hover:text-primary transition-colors">Skills</a></li>
        <li>/</li>
        <li class="text-fg font-medium">{data.skill.name}</li>
      </ol>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Main Content -->
      <div class="lg:col-span-2 space-y-8">
        <!-- Header -->
        <div class="card">
          <div class="flex items-start gap-4">
            <!-- Avatar: show org avatar, owner avatar, or GitHub avatar -->
            {#if data.skill.orgAvatar}
              <img
                src={data.skill.orgAvatar}
                alt={data.skill.orgName}
                class="w-16 h-16 rounded-xl border-2 border-border"
              />
            {:else if data.skill.ownerAvatar}
              <img
                src={data.skill.ownerAvatar}
                alt={data.skill.ownerName}
                class="w-16 h-16 rounded-xl border-2 border-border"
              />
            {:else if data.skill.repoOwner}
              <img
                src={`https://github.com/${data.skill.repoOwner}.png`}
                alt={data.skill.repoOwner}
                class="w-16 h-16 rounded-xl border-2 border-border"
              />
            {:else}
              <div class="w-16 h-16 rounded-xl border-2 border-border bg-primary flex items-center justify-center text-white text-2xl font-bold">
                {data.skill.name[0].toUpperCase()}
              </div>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h1 class="text-2xl md:text-3xl font-bold text-fg">{data.skill.name}</h1>
                <!-- Visibility Badge -->
                <span class="px-2 py-0.5 text-xs font-medium rounded-full {getVisibilityColor(data.skill.visibility)}">
                  {data.skill.visibility}
                </span>
                {#if data.skill.sourceType === 'upload'}
                  <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    uploaded
                  </span>
                {/if}
              </div>
              <p class="text-fg-muted mb-3">{data.skill.description || 'No description'}</p>
              <div class="flex flex-wrap items-center gap-4 text-sm">
                <!-- Owner/Org link -->
                {#if data.skill.orgSlug}
                  <a
                    href="/org/{data.skill.orgSlug}"
                    class="flex items-center gap-1.5 text-fg-muted hover:text-primary transition-colors"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    {data.skill.orgName}
                  </a>
                {:else if data.skill.ownerName}
                  <a
                    href="/u/{data.skill.ownerName}"
                    class="flex items-center gap-1.5 text-fg-muted hover:text-primary transition-colors"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {data.skill.ownerName}
                  </a>
                {:else if data.skill.repoOwner}
                  <a
                    href="https://github.com/{data.skill.repoOwner}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-1.5 text-fg-muted hover:text-primary transition-colors"
                  >
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    {data.skill.repoOwner}
                  </a>
                {/if}
                <!-- Stars (only for GitHub skills) -->
                {#if data.skill.sourceType === 'github'}
                  <span class="flex items-center gap-1 text-fg-muted">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                    </svg>
                    {data.skill.stars.toLocaleString()}
                  </span>
                  {#if data.skill.forks}
                    <span class="flex items-center gap-1 text-fg-muted">
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      {data.skill.forks}
                    </span>
                  {/if}
                {/if}
                <span class="text-fg-muted">
                  Updated {formatRelativeTime(data.skill.updatedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Installation -->
        <div class="card">
          <h2 class="text-lg font-semibold text-fg mb-4">Installation</h2>

          <!-- CLI Selector -->
          <div class="flex gap-2 mb-4">
            {#each installCommands as installer (installer.name)}
              <button
                class="install-tab"
                class:install-tab-active={selectedInstaller === installer.name}
                onclick={() => selectedInstaller = installer.name}
              >
                {installer.label}
              </button>
            {/each}
          </div>

          <!-- Command -->
          <div class="flex items-center gap-3 p-3 bg-bg-subtle rounded-lg font-mono text-sm">
            <code class="flex-1 text-fg overflow-x-auto">{currentCommand}</code>
            <CopyButton text={currentCommand} />
          </div>

          <!-- Description -->
          <p class="mt-2 text-xs text-fg-muted">
            {installCommands.find(c => c.name === selectedInstaller)?.description}
          </p>
        </div>

        <!-- README -->
        {#if data.skill.readme}
          <div class="card">
            <h2 class="text-lg font-semibold text-fg mb-4">README</h2>
            <div class="prose prose-sm max-w-none text-fg">
              <pre class="whitespace-pre-wrap text-sm bg-bg-subtle p-4 rounded-lg overflow-x-auto">{data.skill.readme}</pre>
            </div>
          </div>
        {/if}

        <!-- Categories -->
        {#if data.skill.categories?.length}
          <div class="card">
            <h2 class="text-lg font-semibold text-fg mb-4">Categories</h2>
            <div class="flex flex-wrap gap-2">
              {#each data.skill.categories as categorySlug}
                {@const category = getCategoryBySlug(categorySlug)}
                {#if category}
                  <a
                    href="/category/{categorySlug}"
                    class="tag hover:bg-primary-subtle hover:text-primary transition-colors"
                  >
                    {category.name}
                  </a>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Actions -->
        <div class="card">
          <div class="space-y-3">
            <Button variant="cute" class="w-full">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Install Skill
            </Button>
            {#if data.skill.githubUrl}
              <Button variant="outline" href={data.skill.githubUrl} class="w-full">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                View on GitHub
              </Button>
            {/if}
            {#if data.isOwner}
              <Button variant="secondary" href="/dashboard" class="w-full">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage Skill
              </Button>
            {/if}
          </div>
        </div>

        <!-- Private Skill Notice -->
        {#if data.skill.visibility === 'private'}
          <div class="card bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
            <div class="flex items-start gap-3">
              <svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div>
                <h4 class="font-medium text-yellow-800 dark:text-yellow-200">Private Skill</h4>
                <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  This skill is private. To install it, you need to authenticate with the CLI first:
                </p>
                <code class="block mt-2 text-xs bg-yellow-100 dark:bg-yellow-900/40 px-2 py-1 rounded">
                  skillscat login
                </code>
              </div>
            </div>
          </div>
        {/if}

        <!-- Stats -->
        <div class="card">
          <h3 class="font-semibold text-fg mb-4">Information</h3>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between">
              <dt class="text-fg-muted">Visibility</dt>
              <dd class="font-medium text-fg capitalize">{data.skill.visibility}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-fg-muted">Source</dt>
              <dd class="font-medium text-fg capitalize">{data.skill.sourceType}</dd>
            </div>
            {#if data.skill.sourceType === 'github'}
              <div class="flex justify-between">
                <dt class="text-fg-muted">Stars</dt>
                <dd class="font-medium text-fg">{data.skill.stars.toLocaleString()}</dd>
              </div>
              {#if data.skill.forks}
                <div class="flex justify-between">
                  <dt class="text-fg-muted">Forks</dt>
                  <dd class="font-medium text-fg">{data.skill.forks}</dd>
                </div>
              {/if}
            {/if}
            <div class="flex justify-between">
              <dt class="text-fg-muted">Last Updated</dt>
              <dd class="font-medium text-fg">{formatRelativeTime(data.skill.updatedAt)}</dd>
            </div>
            <div class="flex justify-between">
              <dt class="text-fg-muted">Indexed</dt>
              <dd class="font-medium text-fg">{formatRelativeTime(data.skill.indexedAt)}</dd>
            </div>
          </dl>
        </div>

        <!-- Related Skills -->
        {#if data.relatedSkills.length > 0}
          <div class="card">
            <h3 class="font-semibold text-fg mb-4">Related Skills</h3>
            <div class="space-y-3">
              {#each data.relatedSkills as relatedSkill (relatedSkill.id)}
                <SkillCardCompact skill={relatedSkill} />
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <!-- Not Found -->
  <div class="not-found-page">
    <div class="not-found-content">
      <div class="not-found-icon">
        <svg class="w-20 h-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h1 class="not-found-code">404</h1>
      <h2 class="not-found-title">Skill Not Found</h2>
      <p class="not-found-message">
        {data.error || "The skill you're looking for doesn't exist or has been removed."}
      </p>
      <div class="not-found-actions">
        <Button variant="cute" href="/trending">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          </svg>
          Browse Skills
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .install-tab {
    padding: 0.625rem 1rem;
    min-height: 44px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--muted-foreground);
    background: transparent;
    border: 2px solid var(--border);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .install-tab:hover {
    color: var(--primary);
    border-color: var(--primary);
  }

  .install-tab-active {
    color: var(--primary-foreground);
    background: var(--primary);
    border-color: var(--primary);
  }

  .install-tab-active:hover {
    color: var(--primary-foreground);
  }

  /* Not Found Page Styles */
  .not-found-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 12rem);
    padding: 2rem;
  }

  .not-found-content {
    text-align: center;
    max-width: 28rem;
  }

  .not-found-icon {
    color: var(--fg-muted);
    margin-bottom: 1rem;
    opacity: 0.5;
    display: flex;
    justify-content: center;
  }

  .not-found-code {
    font-size: clamp(4rem, 10vw, 7rem);
    font-weight: 900;
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    margin-bottom: 0.5rem;
  }

  .not-found-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--fg);
    margin-bottom: 0.75rem;
  }

  .not-found-message {
    font-size: 0.9375rem;
    color: var(--fg-muted);
    margin-bottom: 2rem;
    line-height: 1.6;
  }

  .not-found-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }
</style>
