import { githubGraphqlRequest, type GitHubGraphqlRequestOptions } from './graphql';

export interface BatchRepoInput {
  owner: string;
  name: string;
  id: string;
}

export interface BatchRepoMetadata {
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  description?: string | null;
  repositoryTopics?: {
    nodes: Array<{ topic: { name: string } }>;
  };
}

export interface GitHubBatchRepoMetadataOptions extends GitHubGraphqlRequestOptions {
  includeExtendedMetadata?: boolean;
  continueOnChunkError?: boolean;
}

export const GRAPHQL_REPO_METADATA_BATCH_SIZE = 50;

function getRepoKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

function toGraphqlString(value: string): string {
  return JSON.stringify(value);
}

export function estimateGraphqlBatchRepoMetadataCalls(
  repos: Array<Pick<BatchRepoInput, 'owner' | 'name'>>
): number {
  const uniqueRepoKeys = new Set<string>();

  for (const repo of repos) {
    if (!repo.owner || !repo.name) continue;
    uniqueRepoKeys.add(getRepoKey(repo.owner, repo.name));
  }

  if (uniqueRepoKeys.size === 0) {
    return 0;
  }

  return Math.ceil(uniqueRepoKeys.size / GRAPHQL_REPO_METADATA_BATCH_SIZE);
}

export async function graphqlBatchRepoMetadata(
  repos: BatchRepoInput[],
  options: GitHubBatchRepoMetadataOptions
): Promise<Map<string, BatchRepoMetadata>> {
  const {
    includeExtendedMetadata = true,
    continueOnChunkError = false,
    ...requestOptions
  } = options;
  const results = new Map<string, BatchRepoMetadata>();
  if (repos.length === 0) return results;

  const uniqueRepos = new Map<string, BatchRepoInput & { ids: string[] }>();
  for (const repo of repos) {
    if (!repo.owner || !repo.name || !repo.id) continue;

    const key = getRepoKey(repo.owner, repo.name);
    const existing = uniqueRepos.get(key);
    if (existing) {
      existing.ids.push(repo.id);
      continue;
    }

    uniqueRepos.set(key, { ...repo, ids: [repo.id] });
  }

  const uniqueRepoList = Array.from(uniqueRepos.values());

  for (let offset = 0; offset < uniqueRepoList.length; offset += GRAPHQL_REPO_METADATA_BATCH_SIZE) {
    const chunk = uniqueRepoList.slice(offset, offset + GRAPHQL_REPO_METADATA_BATCH_SIZE);

    const repoQueries = chunk.map((repo, idx) => {
      const alias = `repo${idx}`;
      return `${alias}: repository(owner: ${toGraphqlString(repo.owner)}, name: ${toGraphqlString(repo.name)}) {
        stargazerCount
        forkCount
        pushedAt
        ${includeExtendedMetadata ? `description
        repositoryTopics(first: 10) {
          nodes { topic { name } }
        }` : ''}
      }`;
    }).join('\n');

    const query = `query { ${repoQueries} }`;
    let data: Record<string, BatchRepoMetadata | null>;
    try {
      ({ data } = await githubGraphqlRequest<Record<string, BatchRepoMetadata | null>>(query, undefined, {
        ...requestOptions,
        allowPartialData: true,
      }));
    } catch (error) {
      if (!continueOnChunkError) {
        throw error;
      }
      console.error('GitHub GraphQL metadata chunk failed:', error);
      continue;
    }

    chunk.forEach((repo, idx) => {
      const repoData = data[`repo${idx}`];
      if (!repoData) return;

      for (const id of repo.ids) {
        results.set(id, repoData);
      }
    });
  }

  return results;
}

export interface ResurrectionRepoMetadata {
  stargazerCount: number;
  pushedAt: string;
}

export async function graphqlRepoResurrectionMetadata(
  owner: string,
  name: string,
  options: GitHubGraphqlRequestOptions
): Promise<ResurrectionRepoMetadata | null> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        stargazerCount
        pushedAt
      }
    }
  `;

  const { data } = await githubGraphqlRequest<{
    repository: ResurrectionRepoMetadata | null;
  }>(query, { owner, name }, {
    ...options,
    allowPartialData: true,
  });

  return data.repository || null;
}
