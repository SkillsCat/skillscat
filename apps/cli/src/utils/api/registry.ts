import { getRegistryUrl } from '../config/config';
import { getBaseUrl, getValidToken } from '../auth/auth';
import { verboseRequest, verboseResponse, verboseLog } from '../core/verbose';
import { parseNetworkError, parseHttpError } from '../core/errors';
import { cacheSkill } from '../storage/cache';
import { parseSlug } from '../core/slug';
import { fetchWithTimeout } from '../core/fetch';

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

export interface RegistryRepoSkillSummary {
  slug: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  skillPath?: string;
  githubUrl?: string;
  visibility?: 'public' | 'private' | 'unlisted';
  updatedAt?: number;
  stars?: number;
}

export interface RegistryRepoResult {
  skills: RegistryRepoSkillSummary[];
  total: number;
}

export interface RegistrySkillFile {
  path: string;
  content: string;
}

export interface RegistrySkillFilesResult {
  folderName: string;
  files: RegistrySkillFile[];
}

export class RegistryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RegistryRequestError';
  }
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
  const { owner, name } = parseSlug(skillIdentifier);
  const registryUrl = getRegistryUrl();
  const url = `${registryUrl}/skill/${owner}/${name}`;

  const headers = await getAuthHeaders();
  const startTime = Date.now();

  verboseRequest('GET', url, headers);

  try {
    const response = await fetchWithTimeout(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const error = parseHttpError(response.status, response.statusText);
      throw new RegistryRequestError(error.message, response.status);
    }

    const payload = await response.json() as SkillRegistryItem;
    const skill: SkillRegistryItem = {
      ...payload,
      slug: payload.slug || skillIdentifier,
      skillPath: payload.skillPath || '',
    };

    if (skill.content && skill.owner && skill.repo) {
      cacheSkill(skill.owner, skill.repo, skill.content, 'registry', skill.skillPath || undefined);
    }
    verboseLog('Using indexed registry content');
    return skill;
  } catch (error) {
    if (error instanceof RegistryRequestError) throw error;
    const networkError = parseNetworkError(error);
    throw new Error(networkError.message);
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

  const registryUrl = getRegistryUrl();
  const url = `${registryUrl}/search?${params}`;
  const headers = await getAuthHeaders();
  const startTime = Date.now();

  verboseRequest('GET', url, headers);

  try {
    const response = await fetchWithTimeout(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      const error = parseHttpError(response.status, response.statusText);
      throw new RegistryRequestError(error.message, response.status);
    }

    return await response.json() as RegistrySearchResult;
  } catch (error) {
    if (error instanceof RegistryRequestError) throw error;
    const networkError = parseNetworkError(error);
    throw new Error(networkError.message);
  }
}

export async function fetchSkillsByRepo(
  owner: string,
  repo: string,
  options?: { path?: string }
): Promise<RegistryRepoResult> {
  const registryUrl = getRegistryUrl();
  const path = options?.path?.replace(/^\/+|\/+$/g, '');
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const query = params.toString();
  const url = `${registryUrl}/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${query ? `?${query}` : ''}`;

  const headers = await getAuthHeaders();
  const startTime = Date.now();
  verboseRequest('GET', url, headers);

  try {
    const response = await fetchWithTimeout(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      if (response.status === 404) {
        return { skills: [], total: 0 };
      }
      const parsed = parseHttpError(response.status, response.statusText);
      throw new RegistryRequestError(parsed.message, response.status);
    }

    return await response.json() as RegistryRepoResult;
  } catch (error) {
    if (error instanceof RegistryRequestError) throw error;
    const networkError = parseNetworkError(error);
    throw new Error(networkError.message);
  }
}

export async function fetchSkillFiles(slug: string): Promise<RegistrySkillFilesResult | null> {
  const url = `${getBaseUrl()}/api/skills/${encodeURIComponent(slug)}/files`;
  const headers = await getAuthHeaders();
  const startTime = Date.now();

  verboseRequest('GET', url, headers);

  try {
    const response = await fetchWithTimeout(url, { headers });
    verboseResponse(response.status, response.statusText, Date.now() - startTime);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const parsed = parseHttpError(response.status, response.statusText);
      throw new RegistryRequestError(parsed.message, response.status);
    }

    const payload = await response.json() as RegistrySkillFilesResult;
    if (!Array.isArray(payload.files)) {
      return null;
    }

    return {
      folderName: payload.folderName,
      files: payload.files.filter((file) => (
        typeof file?.path === 'string'
        && typeof file?.content === 'string'
      )),
    };
  } catch (error) {
    if (error instanceof RegistryRequestError) throw error;
    const networkError = parseNetworkError(error);
    throw new Error(networkError.message);
  }
}
