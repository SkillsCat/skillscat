<script lang="ts">
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import DocsTableOfContents from '$lib/components/docs/DocsTableOfContents.svelte';
  import { getDocsCopy } from '$lib/i18n/docs';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  const docsCopy = getDocsCopy('en');
  const commonCopy = docsCopy.common;
  const pageCopy = docsCopy.openclaw;
  const title = pageCopy.title;
  const description = pageCopy.description;
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-openclaw' });

  const toc = [
    { id: 'auto-install', label: 'Compatibility Auto-Install' },
    { id: 'host-cli-install', label: 'Host CLI Install' },
    { id: 'registry-override', label: 'Override Site and Registry' },
    { id: 'paths-and-layout', label: 'Paths and Bundle Layout' },
    { id: 'private-skills', label: 'Private Skills and Tokens' },
    { id: 'troubleshooting', label: 'Troubleshooting' },
  ] as const;

  const installTargets = [
    {
      target: 'Project-local install',
      path: '<workspace>/skills/<folder-name>/',
      usage: 'Recommended default. The skill stays with the project, which keeps collaboration and versioning clearer.',
    },
    {
      target: 'Global install',
      path: '~/.openclaw/skills/<folder-name>/',
      usage: 'Use this only for personal cross-project reuse, not for project-bound workflows.',
    },
  ] as const;

  const structuredData = $derived([
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: title,
      description,
      url: `${SITE_URL}/docs/openclaw`,
      step: [
        {
          '@type': 'HowToStep',
          name: pageCopy.howToSteps.point.name,
          text: pageCopy.howToSteps.point.text,
        },
        {
          '@type': 'HowToStep',
          name: pageCopy.howToSteps.inspect.name,
          text: pageCopy.howToSteps.inspect.text,
        },
        {
          '@type': 'HowToStep',
          name: pageCopy.howToSteps.install.name,
          text: pageCopy.howToSteps.install.text,
        },
      ],
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
          item: `${SITE_URL}/docs/openclaw`,
        },
      ],
    },
  ]);
</script>

<SEO
  {title}
  {description}
  url="/docs/openclaw"
  image={ogImageUrl}
  imageAlt={pageCopy.imageAlt}
  keywords={[
    'openclaw skills',
    'openclaw docs',
    'skillscat openclaw',
    'openclaw install guide',
    'clawbot skills',
    'skillscat clawhub',
  ]}
  type="article"
  section="Documentation"
  tags={['OpenClaw', 'ClawBot', 'SkillsCat']}
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
          This guide separates two different CLI paths: <code>clawhub</code> uses the
          <code>/openclaw</code> compatibility layer, while <code>skillscat</code> keeps using the
          native SkillsCat registry.
        </p>
      </div>
    </section>

    <div class="docs-content-grid">
      <div class="docs-main">
        <DocsProseCard title="docs/openclaw.md">
          <p>
            There are two routes here. If you use <code>clawhub</code>, point it at the
            <code>https://skills.cat/openclaw</code> compatibility surface. If you use our native
            <code>skillscat</code> CLI, keep using the primary SkillsCat <code>/registry</code> and
            do not switch to the compatibility layer.
          </p>

          <h2 id="auto-install">Compatibility Auto-Install</h2>
          <p>
            If you want to keep the default OpenClaw or ClawHub workflow, point both
            <code>site</code> and <code>registry</code> at SkillsCat. Search, install, update,
            inspect, and publish operations will then flow through the SkillsCat
            <code>/openclaw</code> compatibility endpoint instead of the native registry.
          </p>
          <pre><code>clawhub search "seo audit" --site https://skills.cat --registry https://skills.cat/openclaw
clawhub inspect &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub install &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub update &lt;owner&gt;~&lt;skill&gt; --site https://skills.cat --registry https://skills.cat/openclaw
clawhub publish ./my-skill --slug &lt;owner&gt;~&lt;skill&gt; --version 1.0.0 --site https://skills.cat --registry https://skills.cat/openclaw</code></pre>
          <ul>
            <li>SkillsCat uses <code>~</code> in ClawHub-compatible slugs, such as <code>owner~skill</code> or <code>owner~path~to~skill</code>.</li>
            <li>Clients can auto-discover the compatibility API through <code>https://skills.cat/.well-known/clawhub.json</code>.</li>
            <li>The <code>clawhub</code> compatibility surface stays under <code>/openclaw</code>; the native <code>skillscat</code> CLI still uses <code>/registry</code>.</li>
            <li>If you run <code>clawhub publish</code>, use the compatible slug format there as well.</li>
          </ul>

          <h2 id="host-cli-install">Host CLI Install</h2>
          <p>
            If you care more about deterministic installs, stable directory layout, and one CLI
            contract, use the native SkillsCat CLI directly. It does not go through
            <code>/openclaw</code>; it keeps using the primary SkillsCat registry and APIs.
          </p>
          <pre><code>npx skillscat info &lt;owner&gt;/&lt;repo&gt;
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --skill "&lt;skill-name&gt;" --agent openclaw
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw --global
npx skillscat convert openclaw --from agents</code></pre>
          <ul>
            <li>Run <code>info</code> before <code>add</code> to avoid installing the wrong skill from a multi-skill repository.</li>
            <li><code>--agent openclaw</code> writes the bundle into the layout OpenClaw expects.</li>
            <li><code>convert openclaw --from agents</code> is useful when migrating existing <code>.agents</code> content.</li>
          </ul>

          <h2 id="registry-override">Override Site and Registry</h2>
          <p>
            If you want SkillsCat to become the default source for future installs, move the config
            into environment variables or a shell alias so you do not have to repeat
            <code>--site</code> and <code>--registry</code> on every command.
          </p>
          <pre><code>export CLAWHUB_SITE=https://skills.cat
export CLAWHUB_REGISTRY=https://skills.cat/openclaw

clawhub search "calendar"
clawhub install &lt;owner&gt;~&lt;skill&gt;
clawhub update &lt;owner&gt;~&lt;skill&gt;</code></pre>
          <p>
            If you only want a temporary override, pass the flags on a single command. The key
            thing to remember is that <code>CLAWHUB_SITE</code> is the site root, but
            <code>CLAWHUB_REGISTRY</code> must point at <code>/openclaw</code> because the native
            <code>/registry</code> path is for the SkillsCat CLI.
          </p>

          <h2 id="paths-and-layout">Paths and Bundle Layout</h2>
          <p>
            Whether you install through the native SkillsCat CLI or the ClawHub compatibility path,
            the important part is that the full bundle lands intact. Do not copy only
            <code>SKILL.md</code>, and do not strip out templates, scripts, JSON, YAML, or other
            companion files.
          </p>
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Directory</th>
                <th>When To Use It</th>
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
          <ul>
            <li>OpenClaw reads the whole folder, not a single file.</li>
            <li>If both local and global installs exist, check the current workspace <code>skills/</code> directory first.</li>
            <li>After install, starting a fresh OpenClaw session is more reliable than relying on hot reload.</li>
          </ul>

          <h2 id="private-skills">Private Skills and Tokens</h2>
          <p>
            For private skills or write actions, first make sure you know which CLI is in use.
            <code>clawhub</code> browser login returns a SkillsCat-compatible token, while
            <code>skillscat</code> keeps its own native auth flow.
          </p>
          <pre><code>clawhub login --site https://skills.cat
clawhub login --token &lt;skillscat-api-token&gt; --site https://skills.cat --registry https://skills.cat/openclaw
npx skillscat login
npx skillscat add &lt;owner&gt;/&lt;repo&gt; --agent openclaw</code></pre>
          <ul>
            <li><code>clawhub login --site https://skills.cat</code> opens the compatibility auth page and pins the registry back to <code>/openclaw</code>.</li>
            <li>If you prefer manual tokens, create one with <code>read</code>, <code>write</code>, and <code>publish</code> scopes on the <a href="/user/tokens">API tokens</a> page.</li>
            <li>The compatibility layer supports authenticated search and known-slug installs. For deeper private browsing, repo-level choices, or more complex private workflows, prefer the native <code>skillscat</code> CLI.</li>
            <li><code>skillscat login</code> only affects the SkillsCat CLI and does not rewrite <code>clawhub</code> registry config.</li>
          </ul>

          <h2 id="troubleshooting">Troubleshooting</h2>
          <ul>
            <li>If the install does not take effect, confirm the target directory first and then start a fresh OpenClaw session.</li>
            <li>If you picked the wrong skill from a multi-skill repository, run <code>npx skillscat info owner/repo</code> and install again with <code>--skill</code>.</li>
            <li>If you only want OpenClaw to auto-pull the bundle and do not want to think about compatibility slugs, prefer <code>npx skillscat add --agent openclaw</code>.</li>
            <li>For private-skill or permission issues, verify token scopes first and then confirm whether the command is using <code>skillscat</code> or <code>clawhub</code>.</li>
          </ul>

          <blockquote>
            For the native <code>skillscat</code> CLI command details, go back to the
            <a href="/docs/cli"> {commonCopy.links.cliDocs}</a>. This guide is focused on the
            <code>clawhub</code> compatibility layer and OpenClaw install paths.
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
