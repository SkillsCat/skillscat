<script lang="ts">
  import { useI18n } from '$lib/i18n/runtime';
  import ChineseDocsContent from '$lib/components/docs/ChineseDocsContent.svelte';
  import DocsPage from '$lib/components/docs/DocsPage.svelte';
  import { getDocsPresentation, getDocsToc } from '$lib/i18n/docs-presentation';
  import CatalanDocsContent from '$lib/components/docs/CatalanDocsContent.svelte';
  import SEO from '$lib/components/common/SEO.svelte';
  import DocsProseCard from '$lib/components/docs/DocsProseCard.svelte';
  import { getDocsCopy } from '$lib/i18n/docs';
  import { buildOgImageUrl } from '$lib/seo/og';
  import { SITE_URL } from '$lib/seo/constants';

  const i18n = useI18n();
  const isCatalan = $derived(i18n.locale() === 'ca');
  const docsCopy = $derived(getDocsCopy(i18n.locale()));
  const commonCopy = $derived(docsCopy.common);
  const pageCopy = $derived(docsCopy.cli);
  const title = $derived(pageCopy.title);
  const description = $derived(pageCopy.description);
  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'docs-cli' });

  const presentation = $derived(getDocsPresentation(i18n.locale()));
  const toc = $derived(getDocsToc('cli', i18n.locale()));

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
      command: 'npx skillscat add owner/my-skill',
      purpose: 'Install a published skill by its exact slug.',
    },
    {
      command: 'npx skillscat add owner/path/to/skill',
      purpose: 'Install a nested published skill by slug when the skill lives below the repo root.',
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

<DocsPage
  title={pageCopy.heading}
  eyebrow={pageCopy.eyebrow}
  summary={presentation.cliSummary}
  backHref={i18n.href('/docs')}
  backLabel={commonCopy.backToDocsAriaLabel}
  {toc}
  tocTitle={presentation.tocTitle}
  tocLabel={presentation.tocLabel}
>
  <DocsProseCard title={pageCopy.eyebrow}>
    {#if isCatalan}
      <CatalanDocsContent kind="cli" />
    {:else if i18n.locale() === 'zh-CN'}
      <ChineseDocsContent kind="cli" />
    {:else}
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
npx skillscat add owner/my-skill
npx skillscat add owner/path/to/skill
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
      <li>For multi-skill repositories, inspect with <code>info</code> first and then install by the exact published slug.</li>
    </ul>

    <h2 id="install-skills">Install Skills</h2>
    <p>
      <code>add</code> is the main install command. By default it installs into the current
      project so the skill stays close to the codebase it belongs to. Reach for
      <code>--global</code> only when you really want cross-project reuse. For published
      skills, prefer the exact slug instead of repo-scoped selection flags.
    </p>
    <pre><code>npx skillscat add owner/my-skill
npx skillscat add owner/path/to/skill
npx skillscat add https://github.com/owner/repo
npx skillscat add owner/my-skill --global
npx skillscat add owner/my-skill --agent openclaw
npx skillscat add owner/repo --list</code></pre>
    <ul>
      <li>Use the published slug for installs, including nested slugs such as <code>owner/path/to/skill</code>.</li>
      <li>If you only know the repository, run <code>info</code> or <code>add owner/repo --list</code> first to discover the right slug.</li>
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
    {/if}
  </DocsProseCard>
</DocsPage>
