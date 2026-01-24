<script lang="ts">
  import { page } from '$app/stores';

  interface UserProfile {
    id: string;
    name: string;
    image: string | null;
    bio: string | null;
    githubUsername: string | null;
    skillCount: number;
    totalStars: number;
    joinedAt: number;
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

  let profile = $state<UserProfile | null>(null);
  let skills = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const username = $derived($page.params.username);

  $effect(() => {
    if (username) {
      loadProfile();
    }
  });

  async function loadProfile() {
    loading = true;
    error = null;

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}`);

      if (!res.ok) {
        if (res.status === 404) {
          error = 'User not found';
        } else {
          error = 'Failed to load profile';
        }
        return;
      }

      const data = await res.json();
      profile = data.user;
      skills = data.skills || [];
    } catch {
      error = 'Failed to load profile';
    } finally {
      loading = false;
    }
  }

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
  {#if loading}
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>Loading profile...</p>
    </div>
  {:else if error}
    <div class="error-container">
      <h1>404</h1>
      <p>{error}</p>
      <a href="/" class="back-link">Back to Home</a>
    </div>
  {:else if profile}
    <header class="profile-header">
      <div class="profile-avatar-container">
        {#if profile.image}
          <img src={profile.image} alt={profile.name} class="profile-avatar" />
        {:else}
          <div class="profile-avatar-placeholder">
            {(profile.name || username)[0].toUpperCase()}
          </div>
        {/if}
      </div>

      <div class="profile-info">
        <h1 class="profile-name">{profile.name || username}</h1>
        <p class="profile-username">@{username}</p>

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

    <section class="skills-section">
      <h2>Public Skills</h2>

      {#if skills.length === 0}
        <div class="empty-skills">
          <p>No public skills yet.</p>
        </div>
      {:else}
        <div class="skills-grid">
          {#each skills as skill}
            <a href="/skills/{skill.slug}" class="skill-card">
              <div class="skill-header">
                <h3 class="skill-name">{skill.name}</h3>
                <div class="skill-stars">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                  {skill.stars}
                </div>
              </div>

              {#if skill.description}
                <p class="skill-description">{skill.description}</p>
              {/if}

              <div class="skill-footer">
                {#if skill.categories.length > 0}
                  <div class="skill-categories">
                    {#each skill.categories.slice(0, 2) as category}
                      <span class="category-tag">{category}</span>
                    {/each}
                  </div>
                {/if}
                <span class="skill-updated">Updated {timeAgo(skill.updatedAt)}</span>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .profile-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem;
    color: var(--muted-foreground);
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-container {
    text-align: center;
    padding: 4rem;
  }

  .error-container h1 {
    font-size: 4rem;
    font-weight: 700;
    color: var(--muted-foreground);
    margin-bottom: 0.5rem;
  }

  .error-container p {
    color: var(--muted-foreground);
    margin-bottom: 1.5rem;
  }

  .back-link {
    color: var(--primary);
    text-decoration: none;
  }

  .back-link:hover {
    text-decoration: underline;
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

  .skills-section h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
  }

  .empty-skills {
    text-align: center;
    padding: 3rem;
    background: var(--card);
    border-radius: 0.75rem;
    border: 1px solid var(--border);
    color: var(--muted-foreground);
  }

  .skills-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .skill-card {
    display: flex;
    flex-direction: column;
    padding: 1.25rem;
    background: var(--card);
    border-radius: 0.75rem;
    border: 2px solid var(--border);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, transform 0.15s;
  }

  .skill-card:hover {
    border-color: var(--primary);
    transform: translateY(-2px);
  }

  .skill-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.5rem;
  }

  .skill-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--foreground);
  }

  .skill-stars {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .skill-description {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    line-height: 1.5;
    margin-bottom: 0.75rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .skill-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: auto;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .skill-categories {
    display: flex;
    gap: 0.375rem;
  }

  .category-tag {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    background: var(--primary-subtle, rgba(var(--primary-rgb), 0.1));
    color: var(--primary);
    border-radius: 0.25rem;
  }

  .skill-updated {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
</style>
