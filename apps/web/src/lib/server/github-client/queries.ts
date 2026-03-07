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
  description: string | null;
  repositoryTopics: {
    nodes: Array<{ topic: { name: string } }>;
  };
}

export async function graphqlBatchRepoMetadata(
  repos: BatchRepoInput[],
  options: GitHubGraphqlRequestOptions
): Promise<Map<string, BatchRepoMetadata>> {
  const results = new Map<string, BatchRepoMetadata>();
  if (repos.length === 0) return results;

  const repoQueries = repos.map((repo, idx) => {
    const alias = `repo${idx}`;
    return `${alias}: repository(owner: "${repo.owner}", name: "${repo.name}") {
      stargazerCount
      forkCount
      pushedAt
      description
      repositoryTopics(first: 10) {
        nodes { topic { name } }
      }
    }`;
  }).join('\n');

  const query = `query { ${repoQueries} }`;
  const { data } = await githubGraphqlRequest<Record<string, BatchRepoMetadata | null>>(query, undefined, {
    ...options,
    allowPartialData: true,
  });

  repos.forEach((repo, idx) => {
    const repoData = data[`repo${idx}`];
    if (repoData) results.set(repo.id, repoData);
  });

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
