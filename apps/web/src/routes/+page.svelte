<script lang="ts">
  import Section from '$lib/components/layout/Section.svelte';
  import Grid from '$lib/components/layout/Grid.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
  import EmptyState from '$lib/components/feedback/EmptyState.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { HugeiconsIcon } from '$lib/components/ui/hugeicons';
  import {
    Fire03Icon,
    Notification01Icon,
    StarIcon,
    RocketIcon,
    Sad01Icon,
    HeartbreakIcon
  } from '@hugeicons/core-free-icons';
  import type { SkillCardData } from '$lib/types';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_NAME, SITE_URL } from '$lib/seo/constants';

  interface Props {
    data: {
      stats: { totalSkills: number };
      trending: SkillCardData[];
      recent: SkillCardData[];
      top: SkillCardData[];
    };
  }

  let { data }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  let displayCount = $derived(i18n.formatNumber(data.stats.totalSkills));
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'home' });
  const homeDescription = $derived(messages.home.heroTitle);
  const homeStructuredData = $derived({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SkillsCat',
    url: SITE_URL,
    description: homeDescription,
    publisher: {
      '@type': 'Organization',
      name: 'SkillsCat',
      url: SITE_URL,
      sameAs: ['https://github.com/backrunner/skillscat'],
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  });
</script>

<SEO
  title={SITE_NAME}
  description={homeDescription}
  url="/"
  image={ogImageUrl}
  imageAlt={messages.legal.homeImageAlt}
  keywords={['ai agent skills', 'skillscat', 'open source skills', 'ai automation']}
  structuredData={homeStructuredData}
/>

<div class="home-page">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
    <!-- Hero Section -->
    <div class="hero-section">
      <div class="hero-card">
        <!-- Decorative circles -->
        <div class="hero-circle hero-circle-yellow"></div>
        <div class="hero-circle hero-circle-blue"></div>

        <div class="hero-content">
          <h1 class="hero-title">{homeDescription}</h1>
          <p class="hero-subtitle">
            {i18n.t(messages.home.heroSubtitle, { count: displayCount })}
          </p>
        </div>
      </div>
    </div>

    <!-- Trending Section -->
    <Section title={messages.home.trendingTitle} href="/trending">
      {#snippet icon()}
        <HugeiconsIcon icon={Fire03Icon} size={20} strokeWidth={2} />
      {/snippet}
      {#if data.trending.length > 0}
        <Grid cols={3} gap="xl">
          {#each data.trending as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <EmptyState
          title={messages.home.trendingEmptyTitle}
          description={messages.home.trendingEmptyDescription}
        >
          {#snippet icon()}
            <HugeiconsIcon icon={RocketIcon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}
    </Section>

    <!-- Recently Added Section -->
    <Section title={messages.home.recentTitle} href="/recent">
      {#snippet icon()}
        <HugeiconsIcon icon={Notification01Icon} size={20} strokeWidth={2} />
      {/snippet}
      {#if data.recent.length > 0}
        <Grid cols={3} gap="xl">
          {#each data.recent as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <EmptyState
          title={messages.home.recentEmptyTitle}
          description={messages.home.recentEmptyDescription}
        >
          {#snippet icon()}
            <HugeiconsIcon icon={Sad01Icon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}
    </Section>

    <!-- Top Rated Section -->
    <Section title={messages.home.topTitle} href="/top">
      {#snippet icon()}
        <HugeiconsIcon icon={StarIcon} size={20} strokeWidth={2} />
      {/snippet}
      {#if data.top.length > 0}
        <Grid cols={3} gap="xl">
          {#each data.top as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <EmptyState
          title={messages.home.topEmptyTitle}
          description={messages.home.topEmptyDescription}
        >
          {#snippet icon()}
            <HugeiconsIcon icon={HeartbreakIcon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}
    </Section>
  </div>
</div>

<style>
  .home-page {
    position: relative;
  }

  .hero-section {
    position: relative;
    margin-bottom: 2.5rem;
  }

  .hero-card {
    background: var(--card);
    border: 2px solid var(--border-sketch);
    border-radius: 0.75rem;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2rem;
    position: relative;
    overflow: hidden;
    box-shadow: 4px 4px 0 var(--border-sketch);
  }

  @media (min-width: 768px) {
    .hero-card {
      flex-direction: row;
      padding: 2rem 3rem;
    }
  }

  /* Decorative circles */
  .hero-circle {
    position: absolute;
    border-radius: 9999px;
    z-index: 0;
  }

  .hero-circle-yellow {
    width: 8rem;
    height: 8rem;
    background: var(--primary);
    top: 0;
    right: 0;
    margin-right: -2.5rem;
    margin-top: -2.5rem;
  }

  .hero-circle-blue {
    width: 6rem;
    height: 6rem;
    background: var(--accent);
    bottom: 0;
    left: 0;
    margin-left: -2.5rem;
    margin-bottom: -2.5rem;
  }

  .hero-content {
    position: relative;
    z-index: 10;
    max-width: 42rem;
  }

  .hero-title {
    font-family: var(--font-display, inherit);
    font-weight: 700;
    font-size: clamp(1.75rem, 4vw + 0.5rem, 3rem);
    line-height: 1.2;
    margin-bottom: 1rem;
    color: var(--card-foreground);
  }

  .hero-subtitle {
    font-size: clamp(1rem, 1.5vw + 0.5rem, 1.125rem);
    color: var(--fg-muted);
    font-weight: 500;
    line-height: 1.6;
  }
</style>
