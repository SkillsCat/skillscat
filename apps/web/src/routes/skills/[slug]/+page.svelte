<script lang="ts">
  import { CopyButton, Button, Section, Grid, SkillCard, SkillCardCompact, EmptyState, ErrorState } from '$lib/components';
  import { getCategoryBySlug } from '$lib/constants/categories';
  import type { SkillDetail, SkillCardData } from '$lib/types';

  interface Props {
    data: {
      skill: SkillDetail | null;
      relatedSkills: SkillCardData[];
      error?: string;
    };
  }

  let { data }: Props = $props();

  const installCommand = $derived(data.skill ? `claude skill add ${data.skill.repoOwner}/${data.skill.name}` : '');

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
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
            <img
              src={data.skill.authorAvatar || `https://github.com/${data.skill.repoOwner}.png`}
              alt={data.skill.repoOwner}
              class="w-16 h-16 rounded-xl border-2 border-border"
            />
            <div class="flex-1 min-w-0">
              <h1 class="text-2xl md:text-3xl font-bold text-fg mb-1">{data.skill.name}</h1>
              <p class="text-fg-muted mb-3">{data.skill.description || 'No description'}</p>
              <div class="flex flex-wrap items-center gap-4 text-sm">
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
          <div class="flex items-center gap-3 p-3 bg-bg-subtle rounded-lg font-mono text-sm">
            <code class="flex-1 text-fg overflow-x-auto">{installCommand}</code>
            <CopyButton text={installCommand} />
          </div>
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
                    {category.emoji} {category.name}
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
            <Button variant="primary" class="w-full">
              <svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Install Skill
            </Button>
            <a
              href={data.skill.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-secondary w-full flex items-center justify-center gap-2"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              View on GitHub
            </a>
          </div>
        </div>

        <!-- Stats -->
        <div class="card">
          <h3 class="font-semibold text-fg mb-4">Statistics</h3>
          <dl class="space-y-3 text-sm">
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
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <ErrorState
      emoji="404"
      title="Skill Not Found"
      message={data.error || "The skill you're looking for doesn't exist or has been removed."}
    />
    <div class="text-center mt-4">
      <a href="/" class="btn btn-primary">
        Back to Home
      </a>
    </div>
  </div>
{/if}
