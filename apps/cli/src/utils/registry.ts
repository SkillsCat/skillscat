import { REGISTRY_URL } from './paths.js';
import { getValidToken } from './auth.js';

export interface SkillRegistryItem {
  name: string;
  description: string;
  owner: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  content: string; // SKILL.md content
  githubUrl: string;
  visibility?: 'public' | 'private' | 'unlisted';
  slug?: string;
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

export async function fetchSkill(skillIdentifier: string): Promise<SkillRegistryItem | null> {
  // skillIdentifier can be:
  // - "@owner/skill-name" (private skill format)
  // - "owner/skill-name" (e.g., "anthropics/commit-message")
  // - "skill-name" (search and pick first match)

  const url = `${REGISTRY_URL}/skill/${encodeURIComponent(skillIdentifier)}`;

  try {
    const response = await fetch(url, {
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      if (response.status === 401) {
        throw new Error('Authentication required. Run `skillscat login` first.');
      }
      if (response.status === 403) {
        throw new Error('You do not have permission to access this skill.');
      }
      throw new Error(`Registry error: ${response.statusText}`);
    }

    return await response.json() as SkillRegistryItem;
  } catch (error) {
    if (error instanceof Error && error.message.includes('fetch')) {
      throw new Error('Unable to connect to SkillsCat registry. Please check your internet connection.');
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

  const url = `${REGISTRY_URL}/search?${params}`;

  try {
    const response = await fetch(url, {
      headers: await getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Registry error: ${response.statusText}`);
    }

    return await response.json() as RegistrySearchResult;
  } catch (error) {
    if (error instanceof Error && error.message.includes('fetch')) {
      throw new Error('Unable to connect to SkillsCat registry. Please check your internet connection.');
    }
    throw error;
  }
}
