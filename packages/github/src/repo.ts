import type { RepoRef } from "./types";

export function parseRepo(input: string): RepoRef | undefined {
  const trimmed = input
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const match =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(
      trimmed,
    );
  if (!match || match[2] === "." || match[2] === "..") return undefined;
  return { owner: match[1]!, name: match[2]! };
}

export const repoSlug = (repo: RepoRef) => `${repo.owner}/${repo.name}`;
