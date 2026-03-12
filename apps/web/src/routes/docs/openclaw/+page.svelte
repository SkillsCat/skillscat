<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import { buildOgImageUrl } from '$lib/seo/og';

  const title = 'SkillsCat OpenClaw Docs';
  const description =
    'Use SkillsCat in OpenClaw with the correct CLI commands, install targets, and bundle structure. SEO-friendly documentation for OpenClaw workflows.';
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-openclaw' });

  const workflowSteps = [
    'Search or inspect the target repository before installing.',
    'Install with `--agent openclaw` so the bundle lands in the OpenClaw layout.',
    'Confirm the folder path and keep the full bundle intact.',
    'Start a new OpenClaw session so the skill is discovered.',
  ] as const;

  const installTargets = [
    {
      target: 'Project-local install',
      path: 'skills/<folder-name>/',
      usage: 'Use this when the skill is tied to the current repository or workspace.',
    },
    {
      target: 'Global install',
      path: '~/.openclaw/skills/<folder-name>/',
      usage: 'Use this only for reusable personal skills you want across multiple projects.',
    },
  ] as const;

  const troubleshooting = [
    'If the skill does not appear, check the installed folder path first and then restart OpenClaw.',
    'If a repository contains multiple skills, run `skillscat info` first and then install with `--skill`.',
    'If you already maintain `.agents` content, use `skillscat convert openclaw --from agents` before cleaning up folders manually.',
  ] as const;
</script>

<SEO
  {title}
  {description}
  url="/docs/openclaw"
  image={ogImageUrl}
  imageAlt="SkillsCat OpenClaw documentation preview"
  keywords={[
    'openclaw skills',
    'openclaw docs',
    'skillscat openclaw',
    'openclaw install guide',
    'clawbot skills',
  ]}
  type="article"
  section="Documentation"
  tags={['OpenClaw', 'ClawBot', 'SkillsCat']}
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
          <p class="docs-eyebrow">OpenClaw Guide</p>
        </div>
        <h1>Use SkillsCat inside OpenClaw</h1>
        <p class="docs-summary">
          Install SkillsCat bundles into OpenClaw or ClawBot with the correct target path, command
          flags, and bundle structure.
        </p>
      </div>
    </section>

    <DocsProseCard title="docs/openclaw.md">
      <p>
        When the destination environment is OpenClaw, install with the OpenClaw-aware target so the
        bundle lands in the expected folder structure. This keeps companion prompts, scripts, JSON,
        YAML, and templates together instead of breaking the skill into incomplete fragments.
      </p>

      <h2>Recommended workflow</h2>
      <ol>
        {#each workflowSteps as step}
          <li>{step}</li>
        {/each}
      </ol>

      <h2>CLI commands</h2>
      <pre><code>npx skillscat info &lt;owner&gt;/&lt;repo&gt;
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --skill "&lt;skill-name&gt;" --agent openclaw
npx skillscat convert openclaw --from agents</code></pre>

      <h2>Install targets</h2>
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Path</th>
            <th>When to use it</th>
          </tr>
        </thead>
        <tbody>
          {#each installTargets as item}
            <tr>
              <td>{item.target}</td>
              <td><code>{item.path}</code></td>
              <td>{item.usage}</td>
            </tr>
          {/each}
        </tbody>
      </table>

      <h2>Bundle rules</h2>
      <ul>
        <li>Keep the full folder that ships with the skill.</li>
        <li>Do not strip templates, helper scripts, config files, or examples out of the bundle.</li>
        <li>Use <a href="/docs/cli">the CLI reference</a> for general search, auth, and publishing flows.</li>
      </ul>

      <h2>Troubleshooting</h2>
      <ul>
        {#each troubleshooting as item}
          <li>{item}</li>
        {/each}
      </ul>
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
