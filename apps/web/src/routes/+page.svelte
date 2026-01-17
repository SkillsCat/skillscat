<script lang="ts">
  import { StatsBanner, Section, Grid, SkillCard, EmptyState } from '$lib/components';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import {
    Fire03Icon,
    Notification01Icon,
    StarIcon,
    RocketIcon,
    Sad01Icon,
    HeartbreakIcon
  } from '@hugeicons/core-free-icons';
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

<div class="home-page">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <!-- Hero Section -->
    <div class="hero-section">
      <div class="hero-deco hero-deco-1 animate-float"></div>
      <div class="hero-deco hero-deco-2 animate-pulse-cute"></div>
      <div class="hero-deco hero-deco-3 animate-float"></div>

      <div class="text-center mb-16 relative z-10">
        <!-- Stats Capsule -->
        <div class="mb-6">
          <StatsBanner count={data.stats.totalSkills} />
        </div>

        <h1 class="hero-title">
          <span class="hero-title-line">Find & Share</span>
          <span class="hero-title-highlight">
            Open Source Agent Skills
            <svg class="hand-drawn-underline" viewBox="0 0 300 20" preserveAspectRatio="none">
              <path d="M5 12 Q 30 5, 60 12 T 120 10 T 180 14 T 240 10 T 295 12" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/>
            </svg>
          </span>
        </h1>
        <p class="hero-subtitle">
          For Claude Code • Codex • Cursor • and more...
        </p>
      </div>
    </div>

    <!-- Trending Section -->
    <Section title="Trending Skills" href="/trending">
      {#snippet icon()}
        <HugeiconsIcon icon={Fire03Icon} size={20} strokeWidth={2} />
      {/snippet}
      {#if data.trending.length > 0}
        <Grid cols={4}>
          {#each data.trending as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <EmptyState
          title="No trending skills yet"
          description="Be the first to submit a skill!"
        >
          {#snippet icon()}
            <HugeiconsIcon icon={RocketIcon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}
    </Section>

    <!-- Recently Added Section -->
    <Section title="Recently Added" href="/recent">
      {#snippet icon()}
        <HugeiconsIcon icon={Notification01Icon} size={20} strokeWidth={2} />
      {/snippet}
      {#if data.recent.length > 0}
        <Grid cols={4}>
          {#each data.recent as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <EmptyState
          title="No skills added yet"
          description="Skills will appear here once they're indexed."
        >
          {#snippet icon()}
            <HugeiconsIcon icon={Sad01Icon} size={40} strokeWidth={1.5} />
          {/snippet}
        </EmptyState>
      {/if}
    </Section>

    <!-- Top Rated Section -->
    <Section title="Top Rated" href="/top">
      {#snippet icon()}
        <HugeiconsIcon icon={StarIcon} size={20} strokeWidth={2} />
      {/snippet}
      {#if data.top.length > 0}
        <Grid cols={4}>
          {#each data.top as skill (skill.id)}
            <SkillCard {skill} />
          {/each}
        </Grid>
      {:else}
        <EmptyState
          title="No top rated skills yet"
          description="Star your favorite skills to see them here."
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
    margin-bottom: 4rem;
  }

  /* Decorative elements */
  .hero-deco {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
  }

  .hero-deco-1 {
    top: -40px;
    right: 10%;
    width: 120px;
    height: 120px;
    background: radial-gradient(circle, var(--primary-subtle), transparent);
    opacity: 0.6;
    animation-delay: 0s;
  }

  .hero-deco-2 {
    top: 20px;
    left: 5%;
    width: 80px;
    height: 80px;
    background: radial-gradient(circle, var(--accent-subtle), transparent);
    opacity: 0.5;
    animation-delay: 1s;
  }

  .hero-deco-3 {
    bottom: -60px;
    right: 20%;
    width: 100px;
    height: 100px;
    background: radial-gradient(circle, var(--primary-subtle), transparent);
    opacity: 0.4;
    animation-delay: 0.5s;
  }

  /* Hero Title */
  .hero-title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .hero-title-line {
    font-size: clamp(2.5rem, 5vw, 3.5rem);
    font-weight: 800;
    color: var(--fg);
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .hero-title-highlight {
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 900;
    background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1.1;
    letter-spacing: -0.03em;
    position: relative;
    display: inline-block;
  }

  .hand-drawn-underline {
    position: absolute;
    bottom: -8px;
    left: 5%;
    width: 90%;
    height: 16px;
    color: var(--primary);
    opacity: 0.6;
  }

  .hero-subtitle {
    font-size: clamp(1.125rem, 2vw, 1.375rem);
    color: var(--fg-muted);
    font-weight: 500;
    max-width: 36rem;
    margin: 0 auto;
    line-height: 1.6;
  }

  /* Animations */
  @keyframes float {
    0%, 100% {
      transform: translateY(0px) rotate(0deg);
    }
    25% {
      transform: translateY(-15px) rotate(2deg);
    }
    75% {
      transform: translateY(-8px) rotate(-2deg);
    }
  }

  .animate-float {
    animation: float 4s ease-in-out infinite;
  }

  .animate-pulse-cute {
    animation: pulse-cute 3s ease-in-out infinite;
  }

  @keyframes pulse-cute {
    0%, 100% {
      transform: scale(1);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.2);
      opacity: 0.8;
    }
  }

  /* Responsive */
  @media (max-width: 768px) {
    .hero-deco {
      display: none;
    }

    .hero-title-line {
      font-size: 2rem;
    }

    .hero-title-highlight {
      font-size: 2rem;
    }
  }
</style>
