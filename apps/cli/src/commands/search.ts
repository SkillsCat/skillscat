import pc from 'picocolors';
import { getResolvedRegistryUrl } from '../utils/config/paths';
import { error, spinner, warn, info } from '../utils/core/ui';
import { verboseRequest, verboseResponse, verboseConfig, isVerbose } from '../utils/core/verbose';
import { parseNetworkError, parseHttpError, formatError } from '../utils/core/errors';

interface SearchOptions {
  category?: string;
  limit?: string;
}

interface RegistrySkill {
  name: string;
  description: string;
  owner: string;
  repo: string;
  stars: number;
  categories: string[];
  platform: 'github' | 'gitlab';
}

interface SearchResult {
  skills: RegistrySkill[];
  total: number;
}

export async function search(query?: string, options: SearchOptions = {}): Promise<void> {
  const limit = parseInt(options.limit || '20', 10);

  // Show verbose config info
  if (isVerbose()) {
    verboseConfig();
  }

  const searchSpinner = spinner(
    query ? `Searching for "${query}"` : 'Fetching trending skills'
  );

  let result: SearchResult;

  try {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options.category) params.set('category', options.category);
    params.set('limit', String(limit));

    const registryUrl = getResolvedRegistryUrl();
    const url = `${registryUrl}/search?${params}`;
    const headers = { 'User-Agent': 'skillscat-cli/1.0' };
    const startTime = Date.now();

    verboseRequest('GET', url, headers);

    const response = await fetch(url, { headers });

    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      if (response.status === 429) {
        searchSpinner.stop(false);
        const httpError = parseHttpError(429);
        warn(httpError.message);
        if (httpError.suggestion) {
          console.log(pc.dim(httpError.suggestion));
        }
        process.exit(1);
      }
      const httpError = parseHttpError(response.status, response.statusText);
      throw new Error(httpError.message);
    }

    result = await response.json() as SearchResult;
  } catch (err) {
    searchSpinner.stop(false);

    // Check for network errors
    const networkError = parseNetworkError(err);
    if (networkError.message.includes('connect') || networkError.message.includes('resolve') || networkError.message.includes('network')) {
      // Fallback: show help for direct GitHub/GitLab usage
      console.log();
      info(networkError.message);
      if (networkError.suggestion) {
        console.log(pc.dim(networkError.suggestion));
      }
      console.log();
      console.log(pc.dim('You can still install skills directly from GitHub/GitLab:'));
      console.log();
      console.log(`  ${pc.cyan('npx skillscat add vercel-labs/agent-skills')}`);
      console.log(`  ${pc.cyan('npx skillscat add owner/repo')}`);
      console.log();
      console.log(pc.dim('Popular skill repositories:'));
      console.log(`  ${pc.dim('•')} vercel-labs/agent-skills - React, Next.js best practices`);
      console.log(`  ${pc.dim('•')} anthropics/claude-code-skills - Official Claude Code skills`);
      return;
    }

    error(err instanceof Error ? err.message : 'Failed to search skills');
    process.exit(1);
  }

  searchSpinner.stop(true);

  if (result.skills.length === 0) {
    warn('No skills found.');
    if (query) {
      console.log(pc.dim('Try a different search term or browse categories.'));
    }
    console.log();
    console.log(pc.dim('You can also install skills directly from GitHub/GitLab:'));
    console.log(`  ${pc.cyan('npx skillscat add owner/repo')}`);
    return;
  }

  console.log();
  console.log(pc.bold(`Found ${result.total} skill(s):`));
  console.log();

  for (const skill of result.skills) {
    const identifier = `${skill.owner}/${skill.repo}`;
    const platformIcon = skill.platform === 'github' ? '' : ' (GitLab)';

    console.log(`  ${pc.bold(pc.cyan(identifier))}${pc.dim(platformIcon)}`);
    if (skill.description) {
      console.log(`  ${pc.dim(skill.description)}`);
    }
    console.log(
      `  ${pc.yellow('★')} ${skill.stars}  ${pc.dim('|')}  ` +
      pc.dim(skill.categories.length > 0 ? skill.categories.join(', ') : 'uncategorized')
    );
    console.log();
  }

  console.log(pc.dim('─'.repeat(50)));
  console.log();
  console.log(pc.dim('Install a skill:'));
  console.log(`  ${pc.cyan('npx skillscat add <owner>/<repo>')}`);
  console.log();
  console.log(pc.dim('View skill details:'));
  console.log(`  ${pc.cyan('npx skillscat info <owner>/<repo>')}`);
}
