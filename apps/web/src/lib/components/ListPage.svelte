<script lang="ts">
  import { SearchBox, Grid, SkillCard, EmptyState } from '$lib/components';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    title: string;
    emoji: string;
    description: string;
    skills: SkillCardData[];
    emptyMessage?: string;
  }

  let { title, emoji, description, skills, emptyMessage = 'No skills found' }: Props = $props();
  let searchQuery = $state('');

  const filteredSkills = $derived(
    searchQuery
      ? skills.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (s.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : skills
  );
</script>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl md:text-4xl font-bold text-fg mb-2">
      {emoji} {title}
    </h1>
    <p class="text-fg-muted">{description}</p>
  </div>

  {#if skills.length > 0}
    <!-- Search -->
    <div class="mb-8 max-w-md">
      <SearchBox
        placeholder="Filter skills..."
        bind:value={searchQuery}
      />
    </div>

    <!-- Results count -->
    <div class="mb-6 text-sm text-fg-muted">
      Showing {filteredSkills.length} of {skills.length} skills
    </div>

    <!-- Skills Grid -->
    <Grid cols={4}>
      {#each filteredSkills as skill (skill.id)}
        <SkillCard {skill} />
      {/each}
    </Grid>

    {#if filteredSkills.length === 0}
      <EmptyState
        emoji="🔍"
        title="No matches"
        description={`No skills found matching "${searchQuery}"`}
      />
    {/if}
  {:else}
    <EmptyState
      emoji={emoji}
      title={emptyMessage}
      description="Skills will appear here once they're indexed."
      actionText="Browse Categories"
      actionHref="/categories"
    />
  {/if}
</div>
