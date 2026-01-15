<script lang="ts">
  // Privacy Policy page
</script>

<svelte:head>
  <title>Privacy Policy - SkillsCat</title>
  <meta name="description" content="SkillsCat Privacy Policy - How we collect, use, and protect your data." />
</svelte:head>

<div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
  <article class="prose prose-lg max-w-none">
    <h1>Privacy Policy</h1>
    <p class="lead">Last updated: January 2025</p>

    <p>
      SkillsCat ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our website and services.
    </p>

    <h2>1. Information We Collect</h2>

    <h3>1.1 Information You Provide</h3>
    <p>When you use SkillsCat, we may collect:</p>
    <ul>
      <li><strong>Account Information:</strong> When you sign in using GitHub or Google OAuth, we receive your public profile information including your username, email address, and profile picture.</li>
      <li><strong>Submitted Content:</strong> Skills you submit to our platform, including GitHub repository URLs.</li>
      <li><strong>User Preferences:</strong> Your favorites and other preferences.</li>
    </ul>

    <h3>1.2 Information Collected Automatically</h3>
    <p>We automatically collect certain information when you visit our website:</p>
    <ul>
      <li><strong>Usage Data:</strong> Pages visited, features used, and actions taken.</li>
      <li><strong>Device Information:</strong> Browser type, operating system, and device type.</li>
      <li><strong>Log Data:</strong> IP address, access times, and referring URLs.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the collected information to:</p>
    <ul>
      <li>Provide and maintain our services</li>
      <li>Authenticate your identity and manage your account</li>
      <li>Process skill submissions and maintain our catalog</li>
      <li>Improve our website and user experience</li>
      <li>Communicate with you about updates and changes</li>
      <li>Detect and prevent fraud or abuse</li>
    </ul>

    <h2>3. Information Sharing</h2>
    <p>We do not sell, trade, or rent your personal information to third parties. We may share information in the following circumstances:</p>
    <ul>
      <li><strong>Service Providers:</strong> We use Cloudflare for hosting and infrastructure services.</li>
      <li><strong>Legal Requirements:</strong> When required by law or to protect our rights.</li>
      <li><strong>With Your Consent:</strong> When you explicitly authorize us to share information.</li>
    </ul>

    <h2>4. Data Storage and Security</h2>
    <p>
      Your data is stored on Cloudflare's infrastructure, which provides enterprise-grade security. We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.
    </p>

    <h2>5. Third-Party Services</h2>
    <p>Our service integrates with:</p>
    <ul>
      <li><strong>GitHub:</strong> For OAuth authentication and fetching repository information. GitHub's privacy policy applies to data collected by GitHub.</li>
      <li><strong>Google:</strong> For OAuth authentication. Google's privacy policy applies to data collected by Google.</li>
      <li><strong>Cloudflare:</strong> For hosting, CDN, and security services.</li>
    </ul>

    <h2>6. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li>Access your personal information</li>
      <li>Correct inaccurate data</li>
      <li>Delete your account and associated data</li>
      <li>Export your data</li>
      <li>Opt out of non-essential data collection</li>
    </ul>

    <h2>7. Cookies</h2>
    <p>
      We use essential cookies for authentication and session management. We do not use tracking cookies or third-party advertising cookies.
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
      If you have any questions about this Privacy Policy, please contact us through our GitHub repository.
    </p>

    <h2>11. Open Source</h2>
    <p>
      SkillsCat is open source software licensed under AGPL-3.0. You can review our source code and data handling practices on our <a href="https://github.com/skillscat/skillscat" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
    </p>
  </article>
</div>

<style>
  .prose {
    color: var(--color-fg);
  }

  .prose h1 {
    font-size: 2.25rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--color-fg);
  }

  .prose h2 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-top: 2rem;
    margin-bottom: 1rem;
    color: var(--color-fg);
  }

  .prose h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    color: var(--color-fg);
  }

  .prose p {
    margin-bottom: 1rem;
    line-height: 1.75;
    color: var(--color-fg-muted);
  }

  .prose .lead {
    font-size: 1.125rem;
    color: var(--color-fg-muted);
  }

  .prose ul {
    margin-bottom: 1rem;
    padding-left: 1.5rem;
    list-style-type: disc;
  }

  .prose li {
    margin-bottom: 0.5rem;
    line-height: 1.75;
    color: var(--color-fg-muted);
  }

  .prose strong {
    font-weight: 600;
    color: var(--color-fg);
  }

  .prose a {
    color: var(--color-primary);
    text-decoration: none;
  }

  .prose a:hover {
    text-decoration: underline;
  }
</style>
