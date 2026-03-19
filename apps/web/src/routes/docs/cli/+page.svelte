<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import DocsTableOfContents from '$lib/components/docs/DocsTableOfContents.svelte';
  import { getDocsCopy } from '$lib/i18n/docs';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  const docsCopy = getDocsCopy('en');
  const commonCopy = docsCopy.common;
  const pageCopy = docsCopy.cli;
  const title = pageCopy.title;
  const description = pageCopy.description;
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-cli' });

  const toc = [
    { id: 'quick-start', label: 'Quick Start' },
    { id: 'search-and-inspect', label: 'Search and Inspect' },
    { id: 'install-skills', label: 'Install Skills' },
    { id: 'manage-installs', label: 'Manage Installs' },
    { id: 'auth-and-config', label: 'Auth and Config' },
    { id: 'publish-and-submit', label: 'Publish and Submit' },
    { id: 'command-reference', label: 'Command Reference' },
  ] as const;

  const commandRows = [
    {
      command: 'npx skillscat search "code review"',
      purpose: 'Search the public SkillsCat registry by task or problem statement.',
    },
    {
      command: 'npx skillscat info owner/repo',
      purpose: 'Inspect which skills a repository contains before you install anything.',
    },
    {
      command: 'npx skillscat add owner/repo',
      purpose: 'Install the default skill bundle into the current project.',
    },
    {
      command: 'npx skillscat add owner/repo --skill "skill-name"',
      purpose: 'Install a single named skill from a multi-skill repository.',
    },
    {
      command: 'npx skillscat update --check',
      purpose: 'Check for updates without overwriting the current install immediately.',
    },
    {
      command: 'npx skillscat login',
      purpose: 'Authenticate with SkillsCat for private skills, publishing, and write actions.',
    },
    {
      command: 'npx skillscat publish ./path/to/skill',
      purpose: 'Publish your own local skill bundle to SkillsCat.',
    },
  ] as const;

  const structuredData = $derived([
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description,
      url: `${SITE_URL}/docs/cli`,
      keywords: [
        'skillscat cli',
        'skillscat install',
        'skillscat search',
        'skillscat publish',
      ],
      author: {
        '@type': 'Organization',
        name: 'SkillsCat',
      },
      publisher: {
        '@type': 'Organization',
        name: 'SkillsCat',
        url: SITE_URL,
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: commonCopy.docsBreadcrumb,
          item: `${SITE_URL}/docs`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: pageCopy.breadcrumb,
          item: `${SITE_URL}/docs/cli`,
        },
      ],
    },
  ]);
</script>

<SEO
  {title}
  {description}
  url="/docs/cli"
  image={ogImageUrl}
  imageAlt={pageCopy.imageAlt}
  keywords={[
    'skillscat cli',
    'skillscat docs',
    'skillscat install command',
    'skillscat search',
    'skillscat publish',
  ]}
  type="article"
  section="Documentation"
  tags={['CLI', 'SkillsCat', 'Install Guide']}
  structuredData={structuredData}
/>

<div class="docs-page">
  <div class="docs-shell">
    <section class="card docs-hero">
      <div class="docs-hero-copy">
        <div class="docs-hero-meta">
          <a href="/docs" class="docs-back-link" aria-label={commonCopy.backToDocsAriaLabel}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path
                d="M15 18l-6-6 6-6"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </a>
          <p class="docs-eyebrow">{pageCopy.eyebrow}</p>
        </div>
        <h1>{pageCopy.heading}</h1>
        <p class="docs-summary">
          This page covers the native SkillsCat CLI. It uses the primary SkillsCat registry, not
          the <code>clawhub</code> compatibility layer.
        </p>
      </div>
    </section>

    <div class="docs-content-grid">
      <div class="docs-main">
        <DocsProseCard title="docs/cli.md">
          <p>
            The SkillsCat CLI is meant to keep search, install, update, and publish workflows for
            AI agent skills in one place. If you remember only one rule, make it this: run
            <code>search</code> or <code>info</code> first, confirm the source and the contents,
            and only then run <code>add</code>.
          </p>
          <p>
            If you are working with the OpenClaw ecosystem and using <code>clawhub</code> rather
            than <code>skillscat</code>, jump to the
            <a href="/docs/openclaw"> {commonCopy.links.openclawDocs}</a>. That guide explains the
            <code>/openclaw</code> compatibility surface.
          </p>

          <h2 id="quick-start">Quick Start</h2>
          <p>For a first session, this command set covers most common workflows.</p>
          <pre><code>npx skillscat search "code review"
npx skillscat info owner/repo
npx skillscat add owner/repo
npx skillscat add owner/repo --skill "skill-name"
npx skillscat update --check
npx skillscat list</code></pre>

          <h2 id="search-and-inspect">Search and Inspect</h2>
          <p>
            If you know the job to be done but not the exact skill to install, start with search.
            Search accepts natural language task phrases, so you can work from the problem first.
            If you already know the GitHub repository, use <code>info</code> to inspect which
            skills it contains and which one would be installed by default.
          </p>
          <pre><code>npx skillscat search "seo audit"
npx skillscat search "jira auth" --category devops
npx skillscat info owner/repo</code></pre>
          <ul>
            <li><code>search</code> is best when you know the task but not the repository.</li>
            <li><code>info</code> is best when you know the repository owner but not the exact bundle layout.</li>
            <li>For multi-skill repositories, inspect with <code>info</code> before deciding whether you need <code>--skill</code>.</li>
          </ul>

          <h2 id="install-skills">Install Skills</h2>
          <p>
            <code>add</code> is the main install command. By default it installs into the current
            project so the skill stays close to the codebase it belongs to. Reach for
            <code>--global</code> only when you really want cross-project reuse.
          </p>
          <pre><code>npx skillscat add owner/repo
npx skillscat add owner/repo --skill "skill-name"
npx skillscat add https://github.com/owner/repo
npx skillscat add owner/repo --list
npx skillscat add owner/repo --global
npx skillscat add owner/repo --agent openclaw</code></pre>
          <ul>
            <li><code>--skill</code> installs one named skill only.</li>
            <li><code>--list</code> previews installable entries without writing files.</li>
            <li><code>--yes</code> skips confirmation prompts for scripted flows.</li>
            <li><code>--force</code> is for overwriting an existing install or continuing through riskier states.</li>
            <li>If the target is OpenClaw, add <code>--agent openclaw</code> so the directory layout is aligned automatically.</li>
          </ul>

          <h2 id="manage-installs">Manage Installs</h2>
          <p>
            After install, the commands you will use most often are <code>list</code>,
            <code>remove</code>, <code>update</code>, and <code>convert</code>.
            <code>update --check</code> is especially useful when you want to inspect changes before
            deciding whether to overwrite the local copy.
          </p>
          <pre><code>npx skillscat list
npx skillscat remove skill-name
npx skillscat update --check
npx skillscat update
npx skillscat convert openclaw --from agents
npx skillscat self-upgrade</code></pre>
          <ul>
            <li><code>list</code> shows what is already installed in the current project or global scope.</li>
            <li><code>remove</code> deletes a local install by skill name.</li>
            <li><code>update</code> prefers registry-backed updates; <code>--check</code> turns it into a dry inspection step.</li>
            <li><code>convert</code> is for moving existing <code>.agents</code> content into OpenClaw or similar layouts.</li>
          </ul>

          <h2 id="auth-and-config">Auth and Config</h2>
          <p>
            Log in when you need private skills, publishing, or other write actions. Public installs
            do not always require auth, but knowing how to use <code>whoami</code> and
            <code>config</code> makes debugging much faster.
          </p>
          <pre><code>npx skillscat login
npx skillscat whoami
npx skillscat logout
npx skillscat config list
npx skillscat config get registry
npx skillscat config set registry https://skills.cat/registry
npx skillscat config delete registry</code></pre>
          <ul>
            <li><code>login</code> authenticates against SkillsCat.</li>
            <li><code>whoami</code> confirms that the current account or token is active.</li>
            <li><code>config set registry ...</code> points the CLI at a custom registry.</li>
            <li>If you need ClawHub-compatible behavior for OpenClaw workflows, continue to the <a href="/docs/openclaw">OpenClaw guide</a>.</li>
          </ul>

          <h2 id="publish-and-submit">Publish and Submit</h2>
          <p>
            SkillsCat has two different write paths. <code>publish</code> uploads a local bundle
            directly to SkillsCat. <code>submit</code> asks SkillsCat to index a public GitHub
            repository. If you later need to remove a published private skill, use
            <code>unpublish</code>.
          </p>
          <pre><code>npx skillscat publish ./my-skill
npx skillscat publish ./my-skill --private
npx skillscat submit https://github.com/owner/repo
npx skillscat unpublish owner/my-skill</code></pre>
          <ul>
            <li><code>publish</code> is for bundles you already prepared locally.</li>
            <li><code>submit</code> is for public GitHub repositories you want SkillsCat to index.</li>
            <li><code>unpublish</code> only applies to already-published private skills.</li>
          </ul>

          <h2 id="command-reference">Command Reference</h2>
          <table>
            <thead>
              <tr>
                <th>Command</th>
                <th>When To Use It</th>
              </tr>
            </thead>
            <tbody>
              {#each commandRows as row}
                <tr>
                  <td><code>{row.command}</code></td>
                  <td>{row.purpose}</td>
                </tr>
              {/each}
            </tbody>
          </table>

          <blockquote>
            If the target environment is OpenClaw or ClawBot, or you want SkillsCat to replace the
            default ClawHub registry, continue to the
            <a href="/docs/openclaw"> {commonCopy.links.openclawGuide}</a>.
          </blockquote>
        </DocsProseCard>
      </div>

      <DocsTableOfContents items={toc} />
    </div>
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
    width: 2.4rem;
    height: 2.4rem;
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

  .docs-content-grid {
    display: grid;
    gap: 1.25rem;
  }

  .docs-main {
    min-width: 0;
  }

  @media (min-width: 900px) {
    .docs-page {
      padding: 2rem 1.5rem 4rem;
    }
  }

  @media (min-width: 1100px) {
    .docs-content-grid {
      grid-template-columns: minmax(0, 1fr) 18rem;
      align-items: start;
    }
  }
</style>
