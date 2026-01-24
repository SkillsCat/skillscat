import pc from 'picocolors';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { isAuthenticated, getValidToken, getBaseUrl } from '../utils/auth.js';

interface SubmitOptions {
  // Reserved for future options
}

interface SubmitResponse {
  success: boolean;
  message?: string;
  error?: string;
  existingSlug?: string;
}

/**
 * Check if a URL is a valid GitHub URL
 */
function isValidGitHubUrl(url: string): boolean {
  // Support HTTPS format
  if (/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url)) {
    return true;
  }
  // Support SSH format
  if (/^git@github\.com:[\w.-]+\/[\w.-]+/.test(url)) {
    return true;
  }
  // Support shorthand format (owner/repo)
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    return true;
  }
  return false;
}

/**
 * Normalize GitHub URL to HTTPS format
 */
function normalizeGitHubUrl(url: string): string {
  // Already HTTPS
  if (url.startsWith('https://github.com/')) {
    return url.replace(/\.git$/, '');
  }
  // HTTP to HTTPS
  if (url.startsWith('http://github.com/')) {
    return url.replace('http://', 'https://').replace(/\.git$/, '');
  }
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@github\.com:(.+)$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1].replace(/\.git$/, '')}`;
  }
  // Shorthand format: owner/repo
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    return `https://github.com/${url}`;
  }
  return url;
}

/**
 * Extract repository URL from package.json
 */
function getRepoUrlFromPackageJson(cwd: string): string | null {
  const packageJsonPath = join(cwd, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as {
      repository?: string | { url?: string; type?: string };
      repo?: string;
    };

    // Check 'repository' field
    if (pkg.repository) {
      if (typeof pkg.repository === 'string') {
        // Could be shorthand "owner/repo" or full URL
        return pkg.repository;
      }
      if (typeof pkg.repository === 'object' && pkg.repository.url) {
        return pkg.repository.url;
      }
    }

    // Check 'repo' field (alternative)
    if (pkg.repo && typeof pkg.repo === 'string') {
      return pkg.repo;
    }

    return null;
  } catch {
    return null;
  }
}

export async function submit(urlArg?: string, _options?: SubmitOptions): Promise<void> {
  // Step 1: Check authentication
  if (!isAuthenticated()) {
    console.error(pc.red('Authentication required.'));
    console.log(pc.dim('Run `skillscat login` first.'));
    process.exit(1);
  }

  // Step 2: Determine the URL to submit
  let repoUrl: string;

  if (urlArg) {
    // URL provided as argument
    repoUrl = urlArg;
  } else {
    // Try to read from package.json
    const cwd = process.cwd();
    const extractedUrl = getRepoUrlFromPackageJson(cwd);

    if (!extractedUrl) {
      console.error(pc.red('No repository URL provided.'));
      console.log();
      console.log('Usage:');
      console.log(pc.dim('  skillscat submit <github-url>'));
      console.log(pc.dim('  skillscat submit                  # reads from package.json'));
      console.log();
      console.log('Examples:');
      console.log(pc.dim('  skillscat submit https://github.com/owner/repo'));
      console.log(pc.dim('  skillscat submit owner/repo'));
      process.exit(1);
    }

    repoUrl = extractedUrl;
    console.log(pc.dim(`Using repository from package.json: ${repoUrl}`));
  }

  // Step 3: Validate and normalize URL
  if (!isValidGitHubUrl(repoUrl)) {
    console.error(pc.red('Invalid GitHub URL.'));
    console.log();
    console.log('Supported formats:');
    console.log(pc.dim('  https://github.com/owner/repo'));
    console.log(pc.dim('  git@github.com:owner/repo.git'));
    console.log(pc.dim('  owner/repo'));
    process.exit(1);
  }

  const normalizedUrl = normalizeGitHubUrl(repoUrl);

  // Step 4: Get valid token (with auto-refresh)
  const token = await getValidToken();
  if (!token) {
    console.error(pc.red('Session expired. Please log in again.'));
    console.log(pc.dim('Run `skillscat login` to authenticate.'));
    process.exit(1);
  }

  // Step 5: Submit to API
  console.log(pc.cyan(`Submitting: ${normalizedUrl}`));

  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: normalizedUrl }),
    });

    const result = await response.json() as SubmitResponse;

    // Handle different response statuses
    if (response.status === 401) {
      console.error(pc.red('Authentication failed.'));
      console.log(pc.dim('Your session may have expired. Run `skillscat login` to re-authenticate.'));
      process.exit(1);
    }

    if (response.status === 409 && result.existingSlug) {
      console.error(pc.yellow('This skill already exists in the registry.'));
      console.log();
      console.log(`View it at: ${pc.cyan(`${baseUrl}/skills/${result.existingSlug}`)}`);
      console.log(`Install with: ${pc.cyan(`skillscat add ${result.existingSlug}`)}`);
      process.exit(1);
    }

    if (response.status === 404) {
      console.error(pc.red('Repository not found.'));
      console.log(pc.dim('Please check the URL and ensure the repository is public.'));
      process.exit(1);
    }

    if (response.status === 400) {
      console.error(pc.red(`Submission failed: ${result.error || 'Invalid request'}`));
      if (result.error?.includes('SKILL.md')) {
        console.log();
        console.log(pc.dim('Make sure your repository has a SKILL.md file in the root directory.'));
        console.log(pc.dim('Learn more: https://skillscat.com/docs/skill-format'));
      }
      if (result.error?.includes('fork') || result.error?.includes('Fork')) {
        console.log();
        console.log(pc.dim('Please submit the original repository instead of a fork.'));
      }
      process.exit(1);
    }

    if (!response.ok || !result.success) {
      console.error(pc.red(`Submission failed: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    // Success!
    console.log();
    console.log(pc.green('Skill submitted successfully!'));
    console.log(pc.dim(result.message || 'It will appear in the catalog once processed.'));
  } catch (error) {
    console.error(pc.red('Failed to connect to SkillsCat.'));
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    process.exit(1);
  }
}
