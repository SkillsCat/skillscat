<script lang="ts">
  import { StatsBanner, Section, Grid, SkillCard, EmptyState } from '$lib/components';
  import type { SkillCardData } from '$lib/types';

  interface Props {
    data: {
      stats: { totalSkills: number };
      trending: SkillCardData[];
      recent: SkillCardData[];
      top: SkillCardData[];
    };
  }

  let { data }: Props = $props();
</script>

<svelte:head>
  <title>SkillsCat - Claude Code Skills Collection</title>
  <meta name="description" content="Discover, install, and share Claude Code agent skills. The cutest collection of AI-powered development tools." />
  <meta property="og:title" content="SkillsCat - Claude Code Skills Collection" />
  <meta property="og:description" content="Discover, install, and share Claude Code agent skills." />
  <meta property="og:type" content="website" />
</svelte:head>

<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
  <!-- Stats Banner -->
  <div class="mb-12">
    <StatsBanner count={data.stats.totalSkills} />
  </div>

  <!-- Hero -->
  <div class="text-center mb-16">
    <h1 class="text-4xl md:text-5xl font-bold text-fg mb-4">
      Discover Claude Code Skills
    </h1>
    <p class="text-lg text-fg-muted max-w-2xl mx-auto">
      The cutest collection of agent skills for Claude Code.
      Find, install, and share skills with the community.
    </p>
  </div>

  <!-- Trending Section -->
  <Section title="🔥 Trending" href="/trending">
    {#if data.trending.length > 0}
      <Grid cols={4}>
        {#each data.trending as skill (skill.id)}
          <SkillCard {skill} />
        {/each}
      </Grid>
    {:else}
      <EmptyState
        emoji="🔥"
        title="No trending skills yet"
        description="Be the first to submit a skill!"
      />
    {/if}
  </Section>

  <!-- Recently Added Section -->
  <Section title="🆕 Recently Added" href="/recent">
    {#if data.recent.length > 0}
      <Grid cols={4}>
        {#each data.recent as skill (skill.id)}
          <SkillCard {skill} />
        {/each}
      </Grid>
    {:else}
      <EmptyState
        emoji="🆕"
        title="No skills added yet"
        description="Skills will appear here once they're indexed."
      />
    {/if}
  </Section>

  <!-- Top Rated Section -->
  <Section title="⭐ Top Rated" href="/top">
    {#if data.top.length > 0}
      <Grid cols={4}>
        {#each data.top as skill (skill.id)}
          <SkillCard {skill} />
        {/each}
      </Grid>
    {:else}
      <EmptyState
        emoji="⭐"
        title="No top rated skills yet"
        description="Star your favorite skills to see them here."
      />
    {/if}
  </Section>
</div>
