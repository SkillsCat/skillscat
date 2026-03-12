<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import { buildOgImageUrl } from '$lib/seo/og';

  const title = 'SkillsCat CLI Docs';
  const description =
    'Reference documentation for the SkillsCat CLI: search, inspect, install, authenticate, update, and publish skills.';
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-cli' });

  const commandRows = [
    {
      task: 'Search the registry',
      command: 'npx skillscat search "code review"',
      usage: 'Use broad task language first, then narrow the query or category.',
    },
    {
      task: 'Inspect a repo',
      command: 'npx skillscat info owner/repo',
      usage: 'Check which skills exist before installing from multi-skill repositories.',
    },
    {
      task: 'Install one bundle',
      command: 'npx skillscat add owner/repo',
      usage: 'Installs the default skill bundle into the current project.',
    },
    {
      task: 'Install one named skill',
      command: 'npx skillscat add owner/repo --skill "skill-name"',
      usage: 'Use this when a repo exposes more than one skill.',
    },
    {
      task: 'Authenticate',
      command: 'npx skillscat login',
      usage: 'Required for private skills and publishing operations.',
    },
    {
      task: 'List installs',
      command: 'npx skillscat list',
      usage: 'See what is already installed before you update or replace bundles.',
    },
    {
      task: 'Check for updates',
      command: 'npx skillscat update --check',
      usage: 'Run a dry check before applying bundle updates.',
    },
  ] as const;

  const installModes = [
    'Use project installs for repo-specific workflows and team automation.',
    'Use `--global` only for reusable personal skills you want across many projects.',
    'Prefer `npx` for one-off usage so the local environment stays clean.',
  ] as const;
</script>

<SEO
  {title}
  {description}
  url="/docs/cli"
  image={ogImageUrl}
  imageAlt="SkillsCat CLI documentation preview"
  keywords={['skillscat cli', 'skillscat docs', 'skillscat install command', 'skillscat search']}
  type="article"
  section="Documentation"
  tags={['CLI', 'SkillsCat', 'Install Guide']}
/>

<div class="docs-page">
  <div class="docs-shell">
    <section class="card docs-hero">
      <div class="docs-hero-copy">
        <div class="docs-hero-meta">
          <a href="/docs" class="docs-back-link" aria-label="Back to docs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </a>
          <p class="docs-eyebrow">CLI Reference</p>
        </div>
        <h1>SkillsCat CLI docs</h1>
        <p class="docs-summary">
          The reference for searching, inspecting, installing, authenticating, updating, and
          publishing skill bundles with the SkillsCat CLI.
        </p>
      </div>
    </section>

    <DocsProseCard title="docs/cli.md">
      <p>
        Start with <code>search</code> when you know the task, and use <code>info</code> when you
        already know the repository. That keeps installs predictable, especially for repositories
        that publish several skills.
      </p>

      <h2>Quick start</h2>
      <pre><code>npx skillscat search "code review"
npx skillscat info owner/repo
npx skillscat add owner/repo
npx skillscat add owner/repo --skill "skill-name"
npx skillscat update --check</code></pre>

      <h2>Core commands</h2>
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Command</th>
            <th>When to use it</th>
          </tr>
        </thead>
        <tbody>
          {#each commandRows as row}
            <tr>
              <td>{row.task}</td>
              <td><code>{row.command}</code></td>
              <td>{row.usage}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <h2>Install scope</h2>
      <ul>
        {#each installModes as mode}
          <li>{mode}</li>
        {/each}
      </ul>

      <h2>Auth and publishing</h2>
      <p>
        Run <code>npx skillscat login</code> before installing private skills or publishing your
        own bundle. Use <code>npx skillscat whoami</code> when you need a fast sanity check for the
        active account.
      </p>
      <pre><code>npx skillscat login
npx skillscat whoami
npx skillscat publish &lt;path&gt;
npx skillscat submit &lt;github-url&gt;</code></pre>

      <blockquote>
        Use <a href="/docs/openclaw">the OpenClaw guide</a> when the install target is OpenClaw or
        ClawBot. Those environments need the correct bundle layout and restart flow.
      </blockquote>
    </DocsProseCard>
  </div>
</div>

<style>
  .docs-page {
    padding: 1.5rem 1rem 4rem;
  }

  .docs-shell {
    max-width: 72rem;
    margin: 0 auto;
    display: grid;
    gap: 1.25rem;
  }

  .docs-hero {
    display: grid;
    gap: 1rem;
    padding: 2rem;
    border-radius: 1.75rem;
  }

  .docs-hero-copy {
    display: grid;
    gap: 0.85rem;
  }

  .docs-hero-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .docs-back-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 2px solid var(--border);
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--fg);
    text-decoration: none;
    transition: transform 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .docs-back-link svg {
    width: 1rem;
    height: 1rem;
  }

  .docs-back-link:hover {
    transform: translateY(-1px);
    border-color: var(--primary);
    color: var(--primary);
  }

  .docs-eyebrow {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--primary);
  }

  h1 {
    margin: 0;
    color: var(--fg);
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1.05;
  }

  .docs-summary {
    margin: 0;
    color: var(--fg-muted);
    line-height: 1.7;
  }

  @media (min-width: 900px) {
    .docs-page {
      padding: 2rem 1.5rem 4rem;
    }
  }
</style>
