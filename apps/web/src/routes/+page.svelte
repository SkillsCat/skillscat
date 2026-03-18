<script lang="ts">
  import Grid from '$lib/components/layout/Grid.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
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
  import { SITE_URL } from '$lib/seo/constants';

  interface Props {
    data: {
      stats: { totalSkills: number };
      trending: SkillCardData[];
      recent: Promise<SkillCardData[]> | SkillCardData[];
      top: Promise<SkillCardData[]> | SkillCardData[];
    };
  }

  let { data }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  let displayCount = $derived(i18n.formatNumber(data.stats.totalSkills));
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'home' });
  const homeTitle = 'SkillsCat | AI Agent Skill Registry and CLI';
  const homeDescription =
    'SkillsCat is an AI agent skill registry and CLI for discovering, installing, and publishing reusable skills for OpenClaw, ClawBot, Claude Code, and local agent workflows.';
  const homeStructuredData = $derived({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'SkillsCat',
        url: SITE_URL,
        description: homeDescription,
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Organization',
        name: 'SkillsCat',
        url: SITE_URL,
        sameAs: ['https://github.com/backrunner/skillscat'],
      },
    ],
  });
</script>

<SEO
  title={homeTitle}
  description={homeDescription}
  url="/"
  image={ogImageUrl}
  imageAlt={messages.legal.homeImageAlt}
  keywords={[
    'skillscat',
    'skillscat cli',
    'skillscat docs',
    'ai agent skills',
    'open source skills',
    'openclaw skills',
    'clawbot skills',
  ]}
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
          <p class="hero-brand">SkillsCat</p>
          <h1 class="hero-title">{messages.home.heroTitle}</h1>
          <p class="hero-subtitle">
            {i18n.t(messages.home.heroSubtitle, { count: displayCount })}
          </p>
        </div>
      </div>
    </div>

    <!-- Trending Section -->
    <section class="home-section">
      <div class="home-section-header">
        <h2 class="home-section-title">
          <span class="home-section-icon">
            <HugeiconsIcon icon={Fire03Icon} size={20} strokeWidth={2} />
          </span>
          {messages.home.trendingTitle}
        </h2>
        <a href="/trending" class="home-view-all-link">
          {messages.common.viewAll}
          <span aria-hidden="true">-></span>
        </a>
      </div>
      {#if data.trending.length > 0}
        <Grid cols={3} gap="xl">
          {#each data.trending as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <div class="home-empty-state">
          <div class="home-empty-state-icon">
            <HugeiconsIcon icon={RocketIcon} size={40} strokeWidth={1.5} />
          </div>
          <h3 class="home-empty-state-title">{messages.home.trendingEmptyTitle}</h3>
          <p class="home-empty-state-description">{messages.home.trendingEmptyDescription}</p>
        </div>
      {/if}
    </section>

    <div class="deferred-home-section">
      <!-- Recently Added Section -->
      <section class="home-section">
        <div class="home-section-header">
          <h2 class="home-section-title">
            <span class="home-section-icon">
              <HugeiconsIcon icon={Notification01Icon} size={20} strokeWidth={2} />
            </span>
            {messages.home.recentTitle}
          </h2>
          <a href="/recent" class="home-view-all-link">
            {messages.common.viewAll}
            <span aria-hidden="true">-></span>
          </a>
        </div>
        {#await data.recent}
          <div class="home-loading-state">
            <p>{messages.common.loading}</p>
          </div>
        {:then recent}
          {#if recent.length > 0}
            <Grid cols={3} gap="xl">
              {#each recent as skill (skill.id)}
                <SkillCard {skill} />
              {/each}
            </Grid>
          {:else}
            <div class="home-empty-state">
              <div class="home-empty-state-icon">
                <HugeiconsIcon icon={Sad01Icon} size={40} strokeWidth={1.5} />
              </div>
              <h3 class="home-empty-state-title">{messages.home.recentEmptyTitle}</h3>
              <p class="home-empty-state-description">{messages.home.recentEmptyDescription}</p>
            </div>
          {/if}
        {/await}
      </section>
    </div>

    <div class="deferred-home-section">
      <!-- Top Rated Section -->
      <section class="home-section">
        <div class="home-section-header">
          <h2 class="home-section-title">
            <span class="home-section-icon">
              <HugeiconsIcon icon={StarIcon} size={20} strokeWidth={2} />
            </span>
            {messages.home.topTitle}
          </h2>
          <a href="/top" class="home-view-all-link">
            {messages.common.viewAll}
            <span aria-hidden="true">-></span>
          </a>
        </div>
        {#await data.top}
          <div class="home-loading-state">
            <p>{messages.common.loading}</p>
          </div>
        {:then top}
          {#if top.length > 0}
            <Grid cols={3} gap="xl">
              {#each top as skill (skill.id)}
                <SkillCard {skill} />
              {/each}
            </Grid>
          {:else}
            <div class="home-empty-state">
              <div class="home-empty-state-icon">
                <HugeiconsIcon icon={HeartbreakIcon} size={40} strokeWidth={1.5} />
              </div>
              <h3 class="home-empty-state-title">{messages.home.topEmptyTitle}</h3>
              <p class="home-empty-state-description">{messages.home.topEmptyDescription}</p>
            </div>
          {/if}
        {/await}
      </section>
    </div>
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

  .hero-brand {
    margin: 0 0 0.65rem;
    font-size: 0.82rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--primary);
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

  .home-section {
    margin-bottom: 3rem;
  }

  .home-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .home-section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--foreground);
  }

  .home-section-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: var(--primary-subtle);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    color: var(--primary);
    transition: all 0.2s ease;
  }

  .home-section-title:hover .home-section-icon {
    transform: rotate(-5deg) scale(1.05);
    background: var(--primary);
    color: var(--primary-foreground);
  }

  .home-view-all-link {
    --btn-shadow-offset: 3px;
    --btn-shadow-color: oklch(50% 0.22 55);

    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #ffffff;
    text-decoration: none;
    background-color: var(--primary);
    border-radius: var(--radius-full);
    box-shadow: 0 var(--btn-shadow-offset) 0 0 var(--btn-shadow-color);
    transform: translateY(0);
    transition:
      transform 0.1s ease,
      box-shadow 0.1s ease,
      background-color 0.15s ease;
  }

  .home-view-all-link:hover {
    --btn-shadow-offset: 5px;
    background-color: var(--primary-hover);
    transform: translateY(-2px);
  }

  .home-view-all-link:active {
    --btn-shadow-offset: 1px;
    transform: translateY(2px);
  }

  .home-empty-state {
    padding: 3rem 1.5rem;
    text-align: center;
  }

  .home-empty-state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 5rem;
    height: 5rem;
    margin-bottom: 1.5rem;
    background: var(--primary-subtle);
    border: 3px solid var(--border-sketch);
    border-radius: 50%;
    animation: home-empty-bounce 2s ease-in-out infinite;
  }

  .home-empty-state-title {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--fg);
  }

  .home-empty-state-description {
    max-width: 20rem;
    margin: 0 auto;
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--fg-muted);
  }

  .deferred-home-section {
    content-visibility: auto;
    contain-intrinsic-size: 1px 1200px;
  }

  .home-loading-state {
    min-height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-muted);
  }

  @media (min-width: 768px) {
    .home-section-title {
      font-size: 1.5rem;
      gap: 0.75rem;
    }

    .home-section-icon {
      width: 2.5rem;
      height: 2.5rem;
    }
  }

  :global(.dark) .home-view-all-link {
    --btn-shadow-color: oklch(40% 0.20 55);
  }

  @keyframes home-empty-bounce {
    0%, 100% {
      transform: translateY(0);
    }

    50% {
      transform: translateY(-8px);
    }
  }
</style>
