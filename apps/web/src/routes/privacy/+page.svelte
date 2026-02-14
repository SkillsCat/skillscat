<script lang="ts">
  import { buildOgImageUrl, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from '$lib/seo/og';
  import { SITE_DESCRIPTION } from '$lib/seo/constants';

  const ogImageUrl = buildOgImageUrl({ type: 'page', slug: 'privacy' });
</script>

<svelte:head>
  <title>Privacy Policy - SkillsCat</title>
  <meta name="description" content={SITE_DESCRIPTION} />
  <link rel="canonical" href="https://skills.cat/privacy" />
  <meta property="og:title" content="Privacy Policy - SkillsCat" />
  <meta property="og:description" content={SITE_DESCRIPTION} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://skills.cat/privacy" />
  <meta property="og:image" content={ogImageUrl} />
  <meta property="og:image:secure_url" content={ogImageUrl} />
  <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
  <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
  <meta property="og:image:alt" content="Privacy policy social preview image" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Privacy Policy - SkillsCat" />
  <meta name="twitter:description" content={SITE_DESCRIPTION} />
  <meta name="twitter:image" content={ogImageUrl} />
</svelte:head>

<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <article class="prose prose-lg max-w-none">
    <h1>Privacy Policy</h1>
    <p class="lead">Last updated: February 14, 2026</p>

    <p>
      SkillsCat ("we", "our", or "us") is an open platform for discovering, sharing, and installing AI agent skills. We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our website and services.
    </p>

    <h2>1. Information We Collect</h2>

    <h3>1.1 Information You Provide</h3>
    <p>When you use SkillsCat, we may collect:</p>
    <ul>
      <li><strong>Account Information:</strong> When you sign in using GitHub OAuth, we receive account data such as your username, email address, profile image, and GitHub account identifier.</li>
      <li><strong>Submitted Content:</strong> Skills you submit, including repository URLs, uploaded SKILL.md content, and related metadata.</li>
      <li><strong>Sharing and Collaboration Data:</strong> If you share private skills or manage organizations, we store the user IDs or email addresses needed to enforce those permissions.</li>
      <li><strong>User Preferences and Credentials:</strong> Your favorites, API token metadata, and account/session records.</li>
    </ul>

    <h3>1.2 Information Collected Automatically</h3>
    <p>We automatically collect certain information when you visit our website:</p>
    <ul>
      <li><strong>Security and Session Data:</strong> Request metadata such as IP address and user-agent may be processed for authentication security, abuse prevention, and rate limiting.</li>
      <li><strong>Usage Events:</strong> We record product events such as submissions, installs, downloads, favorites, and unfavorites with timestamps.</li>
      <li><strong>Infrastructure Logs:</strong> Cloudflare infrastructure may generate operational logs for reliability and security.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the collected information to:</p>
    <ul>
      <li>Provide and maintain our services</li>
      <li>Authenticate your identity and manage your account</li>
      <li>Process skill submissions/uploads and maintain our catalog</li>
      <li>Enforce access controls for private, unlisted, and shared skills</li>
      <li>Generate aggregate usage statistics (for example trending and download metrics)</li>
      <li>Provide account features such as API tokens, notifications, and organization permissions</li>
      <li>Detect and prevent fraud or abuse</li>
    </ul>

    <h2>3. Information Sharing</h2>
    <p>We do not sell, trade, or rent your personal information to third parties. We may share information in the following circumstances:</p>
    <ul>
      <li><strong>Public Content:</strong> Public skills and related public profile metadata are visible to other users.</li>
      <li><strong>Service Providers:</strong> We use providers such as Cloudflare (hosting/infrastructure), GitHub (OAuth and repository APIs), optional OpenRouter/DeepSeek model APIs (for automated skill classification when enabled), and Google Fonts (font delivery).</li>
      <li><strong>Collaboration Features:</strong> If you share a private skill with another user or email address, that permission data is stored and used to grant access.</li>
      <li><strong>Legal Requirements:</strong> When required by law or to protect our rights.</li>
    </ul>

    <h2>4. Data Storage and Security</h2>
    <p>
      Your data is stored primarily on Cloudflare infrastructure (including D1, KV, and R2). We implement reasonable technical and organizational measures to protect personal information against unauthorized access, alteration, disclosure, or destruction.
    </p>

    <h2>5. Third-Party Services</h2>
    <p>Our service integrates with:</p>
    <ul>
      <li><strong>GitHub:</strong> For OAuth authentication and repository metadata/content access.</li>
      <li><strong>Cloudflare:</strong> For hosting, CDN, D1, KV, R2, and security services.</li>
      <li><strong>OpenRouter / DeepSeek (optional):</strong> For automated skill classification if these providers are configured.</li>
      <li><strong>Google Fonts:</strong> For web font delivery.</li>
    </ul>

    <h2>6. Your Rights</h2>
    <p>You can:</p>
    <ul>
      <li>Delete your account from account settings. This removes sessions, tokens, favorites, private skills, and related account data.</li>
      <li>Understand that public skills are preserved as public records and detached from your account after deletion; signing in again with the same GitHub account can relink them.</li>
      <li>Manage favorites, API tokens, and shared-skill permissions through product settings.</li>
      <li>Update core profile information through your GitHub account.</li>
      <li>Contact us through the repository for additional privacy requests.</li>
    </ul>

    <h2>7. Cookies</h2>
    <p>
      We use essential cookies for authentication and session management. We do not use advertising cookies or third-party tracking cookies.
    </p>

    <h2>8. Children's Privacy</h2>
    <p>
      Our service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13.
    </p>

    <h2>9. Changes to This Policy</h2>
    <p>
      We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
    </p>

    <h2>10. Contact Us</h2>
    <p>
      If you have any questions about this Privacy Policy, please contact us through our <a href="https://github.com/backrunner/skillscat" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
    </p>

    <h2>11. Open Source</h2>
    <p>
      SkillsCat is open source software licensed under AGPL-3.0. You can review our source code and data handling practices on our <a href="https://github.com/backrunner/skillscat" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
    </p>
  </article>
</div>

<style>
  .prose {
    color: var(--foreground);
  }

  .prose h1 {
    font-size: 2.25rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--foreground);
  }

  .prose h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 1rem;
    color: var(--foreground);
  }

  .prose h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: var(--foreground);
  }

  .prose p {
    margin-bottom: 1rem;
    line-height: 1.75;
    color: var(--muted-foreground);
  }

  .prose .lead {
    font-size: 1.125rem;
    color: var(--muted-foreground);
  }

  .prose ul {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
    list-style-type: disc;
  }

  .prose li {
    margin-bottom: 0.5rem;
    line-height: 1.75;
    color: var(--muted-foreground);
  }

  .prose strong {
    font-weight: 600;
    color: var(--foreground);
  }

  .prose a {
    color: var(--primary);
    text-decoration: none;
  }

  .prose a:hover {
    text-decoration: underline;
  }
</style>
