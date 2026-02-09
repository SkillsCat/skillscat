<script lang="ts">
  import { page } from "$app/stores";
  import Avatar from '$lib/components/common/Avatar.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';

  interface Org {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    description: string;
    avatarUrl: string;
    verified: boolean;
    memberCount: number;
    skillCount: number;
    userRole: string | null;
  }

  interface Member {
    userId: string;
    name: string;
    image: string;
    role: string;
  }

  interface Skill {
    id: string;
    name: string;
    slug: string;
    description: string;
    visibility: "public" | "private" | "unlisted";
    stars: number;
  }

  type Tab = "skills" | "members";

  let org = $state<Org | null>(null);
  let members = $state<Member[]>([]);
  let skills = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state<Tab>("skills");

  const slug = $derived($page.params.slug);
  const isAdmin = $derived(
    org?.userRole && ["owner", "admin"].includes(org.userRole),
  );

  $effect(() => {
    if (slug) {
      loadOrg();
    }
  });

  async function loadOrg() {
    loading = true;
    error = null;

    try {
      const [orgRes, membersRes, skillsRes] = await Promise.all([
        fetch(`/api/orgs/${slug}`),
        fetch(`/api/orgs/${slug}/members`),
        fetch(`/api/orgs/${slug}/skills`),
      ]);

      if (orgRes.ok) {
        const data = (await orgRes.json()) as { organization?: Org };
        org = data.organization ?? null;
      } else {
        error = "Organization not found";
        return;
      }

      if (membersRes.ok) {
        const data = (await membersRes.json()) as { members?: Member[] };
        members = data.members || [];
      }

      if (skillsRes.ok) {
        const data = (await skillsRes.json()) as { skills?: Skill[] };
        skills = data.skills || [];
      }
    } catch {
      error = "Failed to load organization";
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{org?.displayName || slug} - SkillsCat</title>
</svelte:head>

<div class="org-page">
  {#if loading}
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading organization...</p>
    </div>
  {:else if error}
    <ErrorState
      title="Organization Not Found"
      message={error}
      primaryActionText="Try Again"
      primaryActionClick={loadOrg}
      secondaryActionText="Go Back"
      secondaryActionClick={() => history.back()}
    />
  {:else if org}
    <!-- Page Header -->
    <header class="org-header">
      <div class="header-left">
        <Avatar
          src={org.avatarUrl}
          alt={org.displayName || org.name}
          fallback={org.slug}
          size="lg"
          shadow
        />
        <div class="header-info">
          <div class="header-title-row">
            <h1>{org.displayName || org.name}</h1>
            {#if org.verified}
              <span class="verified-badge" title="Verified Organization">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
            {/if}
          </div>
          <p class="org-slug">@{org.slug}</p>
          {#if org.description}
            <p class="org-description">{org.description}</p>
          {/if}
          <div class="org-stats">
            <span
              >{org.memberCount} member{org.memberCount !== 1 ? "s" : ""}</span
            >
            <span class="separator">·</span>
            <span>{org.skillCount} skill{org.skillCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
      {#if isAdmin}
        <div class="header-actions">
          <Button variant="cute" size="sm" href="/org/{slug}/settings">
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Settings
          </Button>
        </div>
      {/if}
    </header>

    <!-- Tab Navigation -->
    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === "skills"}
        onclick={() => (activeTab = "skills")}
      >
        <svg
          class="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        Skills
        <span class="tab-count">{skills.length}</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === "members"}
        onclick={() => (activeTab = "members")}
      >
        <svg
          class="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        Members
        <span class="tab-count">{members.length}</span>
      </button>
    </div>

    <!-- Tab Content -->
    <div class="tab-content">
      {#if activeTab === "skills"}
        <!-- Skills Tab -->
        {#if skills.length > 0}
          <div class="skills-grid">
            {#each skills as skill (skill.id)}
              <a href="/skills/{skill.slug}" class="skill-card">
                <h3>{skill.name}</h3>
                {#if skill.description}
                  <p>{skill.description}</p>
                {/if}
                <div class="skill-meta">
                  <span class="stars">
                    <svg
                      class="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"
                      />
                    </svg>
                    {skill.stars}
                  </span>
                </div>
              </a>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <svg
              class="empty-icon"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            <h3>No skills yet</h3>
            <p>This organization hasn't published any skills.</p>
          </div>
        {/if}
      {:else}
        <!-- Members Tab -->
        {#if members.length > 0}
          <div class="members-grid">
            {#each members as member}
              <a href="/u/{member.name}" class="member-card">
                <Avatar
                  src={member.image}
                  alt={member.name}
                  fallback={member.name}
                  size="md"
                  useGithubFallback
                />
                <div class="member-info">
                  <span class="member-name">{member.name}</span>
                  <span class="member-role">{member.role}</span>
                </div>
              </a>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <svg
              class="empty-icon"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <h3>No members</h3>
            <p>This organization has no public members.</p>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .org-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  /* Header */
  .org-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
    margin-bottom: 2rem;
    padding-bottom: 2rem;
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    gap: 1.5rem;
    flex: 1;
    min-width: 0;
  }

  .header-info {
    flex: 1;
    min-width: 0;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
  }

  .verified-badge {
    color: var(--primary);
  }

  .org-slug {
    color: var(--muted-foreground);
    margin-bottom: 0.5rem;
  }

  .org-description {
    margin-bottom: 0.75rem;
    line-height: 1.5;
  }

  .org-stats {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .separator {
    opacity: 0.5;
  }

  .header-actions {
    flex-shrink: 0;
  }

  /* Tabs - Cute Style */
  .tabs {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .tabs button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--muted-foreground);
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: var(--radius-lg);
    cursor: pointer;
    box-shadow: 0 3px 0 0 oklch(75% 0.02 85);
    transition: all 0.15s ease;
    transform: translateY(0);
  }

  :global(.dark) .tabs button {
    box-shadow: 0 3px 0 0 oklch(25% 0.02 85);
  }

  .tabs button:hover {
    color: var(--foreground);
    border-color: var(--primary);
  }

  .tabs button.active {
    color: var(--primary);
    border-color: var(--primary);
    background: var(--primary-subtle);
    box-shadow: 0 1px 0 0 var(--primary);
    transform: translateY(2px);
  }

  .tab-count {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.125rem 0.5rem;
    background: var(--muted);
    border-radius: var(--radius-full);
    transition: all 0.15s ease;
  }

  .tabs button.active .tab-count {
    background: var(--primary);
    color: white;
  }

  /* Tab Content */
  .tab-content {
    min-height: 200px;
  }

  /* Skills Grid */
  .skills-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .skill-card {
    padding: 1.25rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
    min-width: 0;
  }

  .skill-card:hover {
    border-color: var(--primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .skill-card h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-card p {
    font-size: 0.875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-meta {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }

  .stars {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* Members Grid */
  .members-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1rem;
  }

  .member-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: all 0.15s ease;
  }

  .member-card:hover {
    border-color: var(--primary);
  }

  .member-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .member-name {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-role {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    text-transform: capitalize;
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .empty-icon {
    width: 3rem;
    height: 3rem;
    color: var(--muted-foreground);
    opacity: 0.5;
    margin-bottom: 1rem;
  }

  .empty-state h3 {
    font-size: 1.125rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .empty-state p {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  /* States */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .loading-spinner {
    width: 2rem;
    height: 2rem;
    border: 3px solid var(--border);
    border-top-color: var(--primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 640px) {
    .org-page {
      padding: 1rem 0.75rem;
    }

    .org-header {
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1.25rem;
      padding-bottom: 1.25rem;
    }

    .header-left {
      flex-direction: row;
      align-items: center;
      gap: 0.75rem;
    }

    .header-left :global(.avatar) {
      width: 3rem;
      height: 3rem;
      flex-shrink: 0;
    }

    .header-info {
      text-align: left;
    }

    .header-title-row {
      justify-content: flex-start;
    }

    h1 {
      font-size: 1.125rem;
    }

    .org-slug {
      font-size: 0.8125rem;
      margin-bottom: 0.25rem;
    }

    .org-description {
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }

    .org-stats {
      font-size: 0.8125rem;
    }

    .header-actions {
      align-self: stretch;
    }

    .header-actions :global(a),
    .header-actions :global(button) {
      width: 100%;
      justify-content: center;
    }

    .tabs {
      gap: 0.5rem;
    }

    .tabs button {
      flex: 1;
      justify-content: center;
      padding: 0.625rem 0.75rem;
      font-size: 0.875rem;
      white-space: nowrap;
      min-height: 2.75rem;
    }

    .skills-grid {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .skill-card {
      padding: 1rem;
    }

    .members-grid {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .member-card {
      padding: 0.75rem;
    }

    .empty-state {
      padding: 2.5rem 1.5rem;
    }

    .loading-state {
      padding: 2.5rem 1.5rem;
    }
  }
</style>
