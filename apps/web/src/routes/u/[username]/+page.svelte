<script lang="ts">
  import { page } from '$app/stores';
  import { ErrorState, EmptyState, SkillCard, Grid, Section } from '$lib/components';

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

  const username = $derived($page.params.username);
  const profile = $derived(data.profile);
  const skills = $derived(data.skills);
  const error = $derived(data.error);

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    });
  }

  function timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }
</script>

<svelte:head>
  <title>{profile?.name || username} - SkillsCat</title>
  <meta name="description" content="View {profile?.name || username}'s skills on SkillsCat" />
</svelte:head>

<div class="profile-page">
  {#if error}
    <ErrorState
      code="404"
      title="User Not Found"
      message={error}
      primaryActionText="Go Home"
      primaryActionHref="/"
    />
  {:else if profile}
    <header class="profile-header">
      <div class="profile-avatar-container">
        {#if profile.image}
          <img src={profile.image} alt={profile.name} class="profile-avatar" />
        {:else}
          <div class="profile-avatar-placeholder">
            {(profile.name || username || 'U')[0].toUpperCase()}
          </div>
        {/if}
      </div>

      <div class="profile-info">
        <h1 class="profile-name">{profile.name || username}</h1>
        <p class="profile-username">
          @{username}
          {#if profile.type === 'Organization'}
            <span class="profile-type-badge">Organization</span>
          {/if}
        </p>

        {#if profile.bio}
          <p class="profile-bio">{profile.bio}</p>
        {/if}

        <div class="profile-stats">
          <div class="stat">
            <span class="stat-value">{profile.skillCount}</span>
            <span class="stat-label">Skills</span>
          </div>
          <div class="stat">
            <span class="stat-value">{profile.totalStars}</span>
            <span class="stat-label">Total Stars</span>
          </div>
        </div>

        <div class="profile-meta">
          {#if profile.githubUsername}
            <a
              href="https://github.com/{profile.githubUsername}"
              target="_blank"
              rel="noopener noreferrer"
              class="github-link"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              {profile.githubUsername}
            </a>
          {/if}
          <span class="joined-date">Joined {formatDate(profile.joinedAt)}</span>
        </div>
      </div>
    </header>

    <Section title="Public Skills">
      {#if skills.length === 0}
        <EmptyState
          emoji="📦"
          title="No Skills Yet"
          description="This user hasn't published any skills yet."
        />
      {:else}
        <Grid>
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
              }}
            />
          {/each}
        </Grid>
      {/if}
    </Section>
  {/if}
</div>

<style>
  .profile-page {
    max-width: 900px;
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

  .profile-avatar, .profile-avatar-placeholder {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .profile-avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--primary), var(--primary-dark, var(--primary)));
    color: white;
    font-size: 3rem;
    font-weight: 700;
  }

  .profile-name {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
  }

  .profile-username {
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
    margin-bottom: 1rem;
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

  .profile-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .github-link {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--foreground);
    text-decoration: none;
  }

  .github-link:hover {
    color: var(--primary);
  }
</style>
