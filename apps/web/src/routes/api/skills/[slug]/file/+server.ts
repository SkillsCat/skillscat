import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCached } from '$lib/server/cache';
import { getPublicSkillFileCacheKey } from '$lib/server/cache/keys';
import { githubRequest } from '$lib/server/github-client/request';
import { resolveSkillSourceInfo, type SkillSourceInfo } from '$lib/server/skill/source';
import {
  buildGithubSkillR2Key,
  buildGithubSkillR2Keys,
  buildUploadSkillR2Key,
  normalizeSkillSlug,
} from '$lib/skill-path';

const PUBLIC_FILE_CACHE_TTL_SECONDS = 300;
const CLIENT_GITHUB_RATE_LIMIT_HEADER = 'x-skillscat-client-github-rate-limited';

interface FilePayload {
  path: string;
  content: string;
}

// Text file extensions
const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yaml', 'yml', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'hpp',
  'html', 'css', 'scss', 'less', 'sass',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  'xml', 'svg', 'sql', 'graphql', 'gql',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'svelte', 'vue', 'astro'
]);

function isTextFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (!ext || TEXT_EXTENSIONS.has(ext)) return true;
  const fileName = path.split('/').pop()?.toLowerCase() || '';
  if (['dockerfile', 'makefile', 'readme', 'license', 'changelog'].includes(fileName)) return true;
  return false;
}

function decodeBase64ToUtf8(base64: string): string {
  const cleanBase64 = base64.replace(/\n/g, '');
  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function buildCandidateR2Keys(skill: SkillSourceInfo, filePath: string): { primaryKey: string; keys: string[] } {
  if (skill.source_type === 'upload') {
    const uploadKey = buildUploadSkillR2Key(skill.slug, filePath);
    if (!uploadKey) {
      throw error(500, 'Invalid upload skill path');
    }

    return {
      primaryKey: uploadKey,
      keys: [uploadKey],
    };
  }

  if (!skill.repo_owner || !skill.repo_name) {
    throw error(500, 'Invalid GitHub skill path');
  }

  return {
    primaryKey: buildGithubSkillR2Key(skill.repo_owner, skill.repo_name, skill.skill_path, filePath),
    keys: buildGithubSkillR2Keys(skill.repo_owner, skill.repo_name, skill.skill_path, filePath),
  };
}

async function loadSkillFilePayload(
  skill: SkillSourceInfo,
  filePath: string,
  r2: R2Bucket,
  githubToken?: string
): Promise<FilePayload> {
  const { primaryKey, keys } = buildCandidateR2Keys(skill, filePath);

  for (const key of keys) {
    const r2Object = await r2.get(key);
    if (!r2Object) continue;

    return {
      path: filePath,
      content: await r2Object.text(),
    };
  }

  if (skill.source_type === 'github' && skill.visibility === 'public' && skill.repo_owner && skill.repo_name) {
    try {
      const fullPath = skill.skill_path ? `${skill.skill_path}/${filePath}` : filePath;
      const contentUrl = `https://api.github.com/repos/${skill.repo_owner}/${skill.repo_name}/contents/${fullPath}`;

      const response = await githubRequest(contentUrl, {
        token: githubToken,
        userAgent: 'SkillsCat/1.0',
      });

      if (response.ok) {
        const data = await response.json() as { content: string; size: number };
        if (data.size > 512 * 1024) {
          throw error(400, 'File too large');
        }

        const content = decodeBase64ToUtf8(data.content);
        await r2.put(primaryKey, content, {
          httpMetadata: { contentType: 'text/plain' },
        });

        return { path: filePath, content };
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) {
        throw err;
      }
      console.error('GitHub fetch failed:', err);
    }
  }

  if (filePath === 'SKILL.md' && skill.readme) {
    return {
      path: filePath,
      content: skill.readme,
    };
  }

  throw error(404, 'File not found');
}

/**
 * GET /api/skills/[slug]/file?path=xxx - Get single file content
 */
export const GET: RequestHandler = async ({ params, platform, request, url, locals }) => {
  const r2 = platform?.env?.R2;
  const githubToken = platform?.env?.GITHUB_TOKEN;
  const waitUntil = platform?.context?.waitUntil?.bind(platform.context);

  if (!r2) {
    throw error(503, 'Storage not available');
  }

  const slug = normalizeSkillSlug(params.slug || '');
  const filePath = url.searchParams.get('path');

  if (!slug) throw error(400, 'Invalid skill slug');
  if (!filePath) throw error(400, 'File path is required');

  if (!/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(slug)) {
    throw error(400, 'Invalid skill slug format');
  }

  if (filePath.includes('..') || filePath.startsWith('/')) {
    throw error(400, 'Invalid file path');
  }

  if (!isTextFile(filePath)) {
    throw error(400, 'File type not supported');
  }

  if (request.headers.get(CLIENT_GITHUB_RATE_LIMIT_HEADER) === '1') {
    console.warn(`Client-side GitHub rate limit header received for skill file ${slug}`);
  }

  const resolved = await resolveSkillSourceInfo(
    {
      db: platform?.env?.DB,
      request,
      locals,
      waitUntil,
    },
    slug
  );

  if (!resolved.skill) {
    throw error(resolved.status, resolved.error || 'Skill not found');
  }

  if (resolved.skill.visibility === 'public') {
    const { data, hit } = await getCached(
      getPublicSkillFileCacheKey(slug, filePath, resolved.skill.updated_at),
      () => loadSkillFilePayload(resolved.skill as SkillSourceInfo, filePath, r2, githubToken),
      PUBLIC_FILE_CACHE_TTL_SECONDS,
      { waitUntil }
    );

    return json(data, {
      headers: {
        'Cache-Control': `public, max-age=${PUBLIC_FILE_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
        'X-Cache': hit ? 'HIT' : 'MISS',
      },
    });
  }

  const data = await loadSkillFilePayload(resolved.skill, filePath, r2, githubToken);
  return json(data, {
    headers: {
      'Cache-Control': resolved.cacheControl,
      'X-Cache': resolved.cacheStatus,
    },
  });
};
