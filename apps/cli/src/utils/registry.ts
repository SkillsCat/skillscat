import { REGISTRY_URL } from './paths.js';

export interface SkillRegistryItem {
  name: string;
  description: string;
  owner: string;
  stars: number;
  updatedAt: number;
  categories: string[];
  content: string; // SKILL.md content
  githubUrl: string;
}

export interface RegistrySearchResult {
  skills: SkillRegistryItem[];
  total: number;
}

export async function fetchSkill(skillIdentifier: string): Promise<SkillRegistryItem | null> {
  // skillIdentifier can be:
  // - "owner/skill-name" (e.g., "anthropics/commit-message")
  // - "skill-name" (search and pick first match)

  const url = `${REGISTRY_URL}/skill/${encodeURIComponent(skillIdentifier)}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
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

export async function searchSkills(query?: string, category?: string, limit = 20): Promise<RegistrySearchResult> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (category) params.set('category', category);
  params.set('limit', String(limit));

  const url = `${REGISTRY_URL}/search?${params}`;

  try {
    const response = await fetch(url);

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
