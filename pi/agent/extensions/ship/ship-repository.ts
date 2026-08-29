export type GitHubRepository = {
  owner: string;
  repository: string;
};

type RepositoryCommandResult = {
  stdout: string;
  code: number;
  killed?: boolean;
};

type RepositoryCommand = (args: string[]) => Promise<RepositoryCommandResult>;

export function parseGitHubRepository(
  value: string,
): GitHubRepository | undefined {
  const match = value
    .trim()
    .match(
      /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)\/?$/i,
    );
  if (!match?.[1] || !match[2]) return undefined;
  return {
    owner: match[1],
    repository: match[2].replace(/\.git$/i, ""),
  };
}

function parseNameWithOwner(value: string): GitHubRepository | undefined {
  const match = value.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match?.[1] || !match[2]) return undefined;
  return { owner: match[1], repository: match[2] };
}

export async function resolveGitHubRepository(
  git: RepositoryCommand,
  github: RepositoryCommand,
): Promise<GitHubRepository | undefined> {
  const canonical = await github([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  if (canonical.code === 0 && !canonical.killed) {
    const repository = parseNameWithOwner(canonical.stdout);
    if (repository) return repository;
  }

  const origin = await git(["remote", "get-url", "origin"]);
  if (origin.code !== 0 || origin.killed) return undefined;
  return parseGitHubRepository(origin.stdout);
}
