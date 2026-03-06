<script lang="ts">
  import { page } from '$app/stores';
  import SEO from '$lib/components/common/SEO.svelte';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';
  import EmptyState from '$lib/components/feedback/EmptyState.svelte';
  import SkillCard from '$lib/components/skill/SkillCard.svelte';
  import Grid from '$lib/components/layout/Grid.svelte';
  import Section from '$lib/components/layout/Section.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Avatar from '$lib/components/common/Avatar.svelte';
  import { useI18n } from '$lib/i18n/runtime';
  import { getProfilesCopy } from '$lib/i18n/profiles';
  import { getUiCopy } from '$lib/i18n/ui';
  import { getLocalizedCategoryBySlug } from '$lib/i18n/categories';
  import { buildSkillPath } from '$lib/skill-path';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  interface UserProfile {
    id: string;
    name: string;
    image: string | null;
    bio: string | null;
    githubUsername: string | null;
    skillCount: number;
    totalStars: number;
    joinedAt: number;
    isRegistered?: boolean;
    type?: 'User' | 'Organization';
  }

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    stars: number;
    categories: string[];
    updatedAt: number;
  }

  interface Props {
    data: {
      profile: UserProfile | null;
      skills: Skill[];
      error?: string;
    };
  }

  let { data }: Props = $props();
  const i18n = useI18n();
  const messages = $derived(i18n.messages());
  const copy = $derived(getProfilesCopy(i18n.locale()));
  const ui = $derived(getUiCopy(i18n.locale()));

  const MAX_SEO_TITLE_LENGTH = 68;
  const MAX_SEO_DESCRIPTION_LENGTH = 160;
  const PROFILE_ITEMLIST_LIMIT = 12;

  function normalizeSeoKeyword(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function trimSeoText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    const sliced = normalized.slice(0, maxLength - 1);
    const cut = sliced.lastIndexOf(' ');
    return `${(cut > Math.floor(maxLength * 0.6) ? sliced.slice(0, cut) : sliced).trim()}…`;
  }

  function cleanSeoText(value: string | null | undefined): string | null {
    if (!value) return null;
    const text = value.replace(/\s+/g, ' ').replace(/[`*_#]/g, '').trim();
    if (!text) return null;
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }

  function extractSeoTokens(value: string | null | undefined): string[] {
    if (!value) return [];
    const tokens = value.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) || [];
    const stopWords = new Set([
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it',
      'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with', 'we', 'our', 'you', 'your'
    ]);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of tokens) {
      if (token.length < 3) continue;
      if (/^\d+$/.test(token)) continue;
      if (stopWords.has(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      result.push(token);
      if (result.length >= 4) break;
    }
    return result;
  }

  const username = $derived($page.params.username ?? '');
  const profile = $derived(data.profile);
  const skills = $derived(data.skills);
  const error = $derived(data.error);
  const profileDisplayName = $derived(profile?.name?.trim() || username);
  const profileCanonicalUrl = $derived(`${SITE_URL}/u/${encodeURIComponent(username)}`);
  const topCategoryNames = $derived((() => {
    const counts = new Map<string, number>();
    for (const skill of skills) {
      for (const categorySlug of skill.categories || []) {
        counts.set(categorySlug, (counts.get(categorySlug) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([slug]) => getLocalizedCategoryBySlug(slug, i18n.locale())?.name)
      .filter((value): value is string => Boolean(value));
  })());
  const profileUpdatedAt = $derived(
    skills.reduce((max, skill) => Math.max(max, skill.updatedAt || 0), 0)
  );
  const profileDescription = $derived((() => {
    const bio = cleanSeoText(profile?.bio);
    const prefix = bio
      ? bio
      : i18n.t(copy.user.seoFallbackDescription, { count: skills.length, name: profileDisplayName });
    return trimSeoText(prefix, MAX_SEO_DESCRIPTION_LENGTH);
  })());
  const ogImageUrl = $derived(
    buildOgImageUrl({
      type: 'user',
      slug: username ?? '',
      version: profileUpdatedAt || profile?.joinedAt || skills.length || 0,
    })
  );
  const pageTitle = $derived(
    profile && !error
      ? trimSeoText(
          i18n.t(copy.user.seoTitle, {
            name: profileDisplayName,
            countPart: skills.length ? ` (${skills.length})` : '',
          }),
          MAX_SEO_TITLE_LENGTH
        )
      : copy.user.seoNotFoundTitle
  );
  const profileSeoKeywords = $derived((() => {
    const keywords: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | null | undefined) => {
      if (!value) return;
      const normalized = normalizeSeoKeyword(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      keywords.push(value.trim());
    };

    push(profileDisplayName);
    push(`@${username}`);
    push(`${profileDisplayName} ai agent skills`);
    push(`${profileDisplayName} skillscat profile`);
    push(`skills by ${profileDisplayName}`);
    push('ai agent skills author');
    push('developer skills profile');
    if (profile?.githubUsername) {
      push(profile.githubUsername);
      push(`${profile.githubUsername} skills`);
    }
    for (const categoryName of topCategoryNames) {
      push(categoryName);
      push(`${categoryName} skills`);
      push(`${categoryName} ai skills`);
    }
    for (const token of extractSeoTokens(profile?.bio)) {
      push(token);
      push(`${token} skills`);
    }
    push('skillscat');

    return keywords.slice(0, 20);
  })());
  const profileSkillItemList = $derived(
    skills
      .slice(0, PROFILE_ITEMLIST_LIMIT)
      .map((skill, index) => ({
        '@type': 'ListItem',
                position: index + 1,
                url: `${SITE_URL}${buildSkillPath(skill.slug)}`,
                name: skill.name,
      }))
  );
  const profileStructuredData = $derived(
    profile && !error
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'ProfilePage',
            name: pageTitle,
            description: profileDescription,
            url: profileCanonicalUrl,
            keywords: profileSeoKeywords.join(', '),
            mainEntity: {
              '@type': profile.type === 'Organization' ? 'Organization' : 'Person',
              name: profileDisplayName,
              url: profileCanonicalUrl,
              image: profile.image || undefined,
              description: profile.bio || undefined,
              sameAs: profile.githubUsername ? [`https://github.com/${profile.githubUsername}`] : undefined,
            },
          },
          {
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
              { '@type': 'ListItem', position: 1, name: copy.user.breadcrumbHome, item: SITE_URL },
              { '@type': 'ListItem', position: 2, name: copy.user.breadcrumbSkills, item: `${SITE_URL}/trending` },
              { '@type': 'ListItem', position: 3, name: profileDisplayName, item: profileCanonicalUrl },
            ],
          },
          ...(profileSkillItemList.length > 0
            ? [{
                '@context': 'https://schema.org',
                '@type': 'ItemList',
                name: i18n.t(copy.user.itemListName, { name: profileDisplayName }),
                url: profileCanonicalUrl,
                numberOfItems: skills.length,
                itemListElement: profileSkillItemList,
              }]
            : [])
        ]
      : null
  );
  const profileShouldNoindex = $derived(skills.length === 0);

  function formatDate(timestamp: number): string {
    return i18n.formatDate(timestamp, {
      year: 'numeric',
      month: 'long',
    });
  }
</script>

{#if profile && !error}
  <SEO
    title={pageTitle}
    description={profileDescription}
    url={profileCanonicalUrl}
    image={ogImageUrl}
    imageAlt={i18n.t(copy.user.imageAlt, { name: profileDisplayName })}
    type="profile"
    keywords={profileSeoKeywords}
    noindex={profileShouldNoindex}
    structuredData={profileShouldNoindex ? null : profileStructuredData}
  />
{:else}
  <SEO
    title={pageTitle}
    description={copy.user.seoNotFoundDescription}
    image={ogImageUrl}
    imageAlt={copy.user.notFoundImageAlt}
    noindex
    structuredData={null}
  />
{/if}

<div class="profile-page">
  {#if error}
    <ErrorState
      code="404"
      title={copy.user.notFoundTitle}
      message={error}
      primaryActionText={messages.common.goHome}
      primaryActionHref="/"
    />
  {:else if profile}
    <header class="profile-header">
      <div class="profile-avatar-wrapper">
        <Avatar
          src={profile.image}
          fallback={username}
          alt={profile.name}
          size="xl"
          shadow
          useGithubFallback
        />
      </div>

      <div class="profile-info">
        <div class="profile-name-row">
          <div class="profile-name-left">
            <h1 class="profile-name">{profile.name || username}</h1>
            <p class="profile-username">
              @{username}
              {#if profile.type === 'Organization'}
                <span class="profile-type-badge">{copy.user.organizationBadge}</span>
              {/if}
            </p>
          </div>
          {#if profile.githubUsername}
            <Button
              variant="cute"
              size="sm"
              href="https://github.com/{profile.githubUsername}"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              {ui.badges.github}
            </Button>
          {/if}
        </div>

        {#if profile.bio}
          <p class="profile-bio">{profile.bio}</p>
        {/if}

        <div class="profile-stats">
          <div class="stat">
            <span class="stat-value">{profile.skillCount}</span>
            <span class="stat-label">{copy.user.skillsLabel}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{profile.totalStars}</span>
            <span class="stat-label">{copy.user.totalStarsLabel}</span>
          </div>
          {#if profile.joinedAt && profile.joinedAt > 0}
            <div class="stat">
              <span class="stat-value">{formatDate(profile.joinedAt)}</span>
              <span class="stat-label">{copy.user.joinedLabel}</span>
            </div>
          {/if}
        </div>
      </div>
    </header>

    <Section title={copy.user.publicSkillsTitle}>
      {#if skills.length === 0}
        <EmptyState
          emoji="📦"
          title={copy.user.emptyTitle}
          description={copy.user.emptyDescription}
        />
      {:else}
        <Grid cols={3}>
          {#each skills as skill}
            <SkillCard
              skill={{
                id: skill.id,
                name: skill.name,
                slug: skill.slug,
                description: skill.description,
                repoOwner: profile.githubUsername || username || '',
                stars: skill.stars,
                updatedAt: skill.updatedAt,
                authorAvatar: profile.image || undefined,
                categories: skill.categories,
              }}
              hideAvatar
            />
          {/each}
        </Grid>
      {/if}
    </Section>
  {/if}
</div>

<style>
  .profile-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .profile-header {
    display: flex;
    gap: 2rem;
    padding-bottom: 2rem;
    margin-bottom: 2rem;
    border-bottom: 1px solid var(--border);
  }

  @media (max-width: 640px) {
    .profile-header {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
  }

  .profile-avatar-wrapper {
    flex-shrink: 0;
  }

  .profile-info {
    flex: 1;
    min-width: 0;
  }

  .profile-name-row {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  @media (max-width: 640px) {
    .profile-name-row {
      flex-direction: column;
      align-items: center;
    }
  }

  .profile-name-left {
    display: flex;
    flex-direction: column;
  }

  .profile-name {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }

  .profile-username {
    color: var(--muted-foreground);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .profile-username {
      justify-content: center;
    }
  }

  .profile-type-badge {
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    background: var(--muted);
    color: var(--muted-foreground);
    border-radius: 9999px;
    font-weight: 500;
  }

  .profile-bio {
    margin-bottom: 1rem;
    line-height: 1.6;
    max-width: 500px;
  }

  .profile-stats {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--foreground);
  }

  .stat-label {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }
</style>
