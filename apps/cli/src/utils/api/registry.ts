import { getResolvedRegistryUrl } from '../config/paths';
import { getValidToken } from '../auth/auth';
import { verboseRequest, verboseResponse, verboseLog } from '../core/verbose';
import { parseNetworkError, parseHttpError } from '../core/errors';
import { getCachedSkill, cacheSkill, calculateContentHash } from '../storage/cache';
import { parseSlug } from '../core/slug';

const GITHUB_API = 'https://api.github.com';

export interface SkillRegistryItem {
  name: string;
  description: string;
  owner: string;
  repo?: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  content: string; // SKILL.md content
  githubUrl: string;
  visibility?: 'public' | 'private' | 'unlisted';
  slug?: string;
  contentHash?: string;
  skillPath?: string;
}

export interface RegistrySearchResult {
  skills: SkillRegistryItem[];
  total: number;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getValidToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'skillscat-cli/0.1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Parse GitHub URL to extract owner, repo, and skill path
 */
function parseGitHubUrl(url: string): { owner: string; repo: string; skillPath?: string } | null {
  // Match: https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/[^\/]+\/(.+))?/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    skillPath: match[3]
  };
}

/**
 * Fetch SKILL.md content directly from GitHub
 */
async function fetchFromGitHub(owner: string, repo: string, skillPath?: string): Promise<string | null> {
  const path = skillPath ? `${skillPath}/SKILL.md` : 'SKILL.md';
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  verboseLog(`Fetching from GitHub: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'skillscat-cli/0.1.0'
      }
    });

    if (!response.ok) {
      verboseLog(`GitHub fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as { content?: string; encoding?: string };
    if (data.encoding === 'base64' && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchSkill(skillIdentifier: string): Promise<SkillRegistryItem | null> {
  // skillIdentifier can be:
  // - "owner/skill-name" (e.g., "anthropics/commit-message")
  // - "skill-name" (search and pick first match)

  // First, query registry to get skill metadata
  const registryUrl = getResolvedRegistryUrl();

  // Use two-segment path for cleaner URLs
  let url: string;
  if (skillIdentifier.includes('/')) {
    // Has owner/name format - use two-segment path
    const { owner, name } = parseSlug(skillIdentifier);
    url = `${registryUrl}/skill/${owner}/${name}`;
  } else {
    // Just skill name - use legacy single-segment path
    url = `${registryUrl}/skill/${encodeURIComponent(skillIdentifier)}`;
  }

  const headers = await getAuthHeaders();
  const startTime = Date.now();

  verboseRequest('GET', url, headers);

  try {
    const response = await fetch(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = parseHttpError(response.status, response.statusText);
      throw new Error(error.message);
    }

    const skill = await response.json() as SkillRegistryItem;

    // For private skills, return as-is (content from R2)
    if (skill.visibility === 'private') {
      verboseLog('Private skill - using registry content');
      return skill;
    }

    // For public skills, try to use cache or fetch from GitHub
    const githubInfo = skill.githubUrl ? parseGitHubUrl(skill.githubUrl) : null;
    if (!githubInfo) {
      verboseLog('No GitHub URL - using registry content');
      return skill;
    }

    const { owner, repo, skillPath } = githubInfo;

    // Check local cache first
    const cached = getCachedSkill(owner, repo, skillPath);
    if (cached) {
      // If we have a contentHash from registry, validate cache
      if (skill.contentHash && cached.contentHash === skill.contentHash) {
        verboseLog('Using cached version (hash match)');
        return { ...skill, content: cached.content };
      }
      // If no contentHash from registry, use cache if recent (< 1 hour)
      if (!skill.contentHash && Date.now() - cached.cachedAt < 3600000) {
        verboseLog('Using cached version (recent)');
        return { ...skill, content: cached.content };
      }
    }

    // Fetch fresh content from GitHub
    verboseLog('Fetching from GitHub...');
    const githubContent = await fetchFromGitHub(owner, repo, skillPath);

    if (githubContent) {
      // Cache the content
      cacheSkill(owner, repo, githubContent, 'github', skillPath);
      verboseLog('Cached GitHub content');
      return {
        ...skill,
        content: githubContent,
        contentHash: calculateContentHash(githubContent)
      };
    }

    // Fall back to registry content (R2)
    verboseLog('GitHub fetch failed - using registry content');
    if (skill.content) {
      cacheSkill(owner, repo, skill.content, 'registry', skillPath);
    }
    return skill;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Authentication') && !error.message.includes('Access denied')) {
      const networkError = parseNetworkError(error);
      throw new Error(networkError.message);
    }
    throw error;
  }
}

export async function searchSkills(
  query?: string,
  category?: string,
  limit = 20,
  includePrivate = false
): Promise<RegistrySearchResult> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (category) params.set('category', category);
  params.set('limit', String(limit));
  if (includePrivate) params.set('include_private', 'true');

  const registryUrl = getResolvedRegistryUrl();
  const url = `${registryUrl}/search?${params}`;
  const headers = await getAuthHeaders();
  const startTime = Date.now();

  verboseRequest('GET', url, headers);

  try {
    const response = await fetch(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      const error = parseHttpError(response.status, response.statusText);
      throw new Error(error.message);
    }

    return await response.json() as RegistrySearchResult;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Rate limit')) {
      const networkError = parseNetworkError(error);
      throw new Error(networkError.message);
    }
    throw error;
  }
}
