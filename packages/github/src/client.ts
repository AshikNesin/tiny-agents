/**
 * The one GitHub client Code uses (issue #297 §7.1): projects, the PR tab
 * and Auto-fix see only this interface, never the transport under it.
 *
 * A PR snapshot is one GraphQL query: state, mergeability, reviews, review
 * threads, conversation comments and the head commit's checks, each comment
 * with its author's association and type, so the trust rules cost no extra
 * call. Mergeability GitHub has not computed yet is `unknown`, never
 * `conflicting` or `mergeable`.
 */
import { GitHubError, type GitHubApi } from "./api";

export interface RepoRef {
  owner: string;
  name: string;
}

export type AuthorType = "user" | "bot";
/** GitHub's `authorAssociation`, as it sends it (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, …). */
export type Association = string;

export interface Author {
  login: string;
  type: AuthorType;
  association: Association;
}

export type CheckState = "pending" | "success" | "failure" | "neutral";

export interface Check {
  name: string;
  state: CheckState;
  /** When it started (or was created, for a status), ISO. */
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
  /** The Actions job id, when the check is an Actions job (for its log). */
  jobId: number | null;
}

export interface Review {
  id: string;
  author: Author;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string;
  submittedAt: string;
}

export interface ReviewComment {
  id: string;
  databaseId: number;
  author: Author;
  body: string;
  createdAt: string;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  comments: ReviewComment[];
}

export interface IssueComment {
  id: string;
  databaseId: number;
  author: Author;
  body: string;
  createdAt: string;
}

export type MergeMethod = "merge" | "squash" | "rebase";

export interface PullSnapshot {
  /** GraphQL node id. */
  id: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headRef: string;
  headSha: string;
  baseRef: string;
  /** The head branch lives in another repository. */
  fromFork: boolean;
  mergeable: "mergeable" | "conflicting" | "unknown";
  mergeMethods: MergeMethod[];
  author: string | null;
  checks: Check[];
  reviews: Review[];
  threads: ReviewThread[];
  comments: IssueComment[];
}

export interface PullRef {
  number: number;
  url: string;
}

export interface GitHubClient {
  readonly transport: GitHubApi["kind"];
  /** Who the credential acts as. */
  viewer(): Promise<{ login: string }>;
  repository(repo: RepoRef): Promise<{ defaultBranch: string; private: boolean }>;
  /** The open PR whose head is `branch` in `repo`, if any (a link by branch match). */
  openPullForBranch(repo: RepoRef, branch: string): Promise<PullRef | undefined>;
  createPull(
    repo: RepoRef,
    input: { head: string; base: string; title: string; body: string; draft: boolean },
  ): Promise<PullRef>;
  snapshot(repo: RepoRef, number: number): Promise<PullSnapshot>;
  /** The end of one Actions job's log, at most `maxChars`. */
  jobLogTail(repo: RepoRef, jobId: number, maxChars: number): Promise<string>;
  replyToThread(threadId: string, body: string): Promise<{ databaseId: number | null }>;
  resolveThread(threadId: string): Promise<void>;
  comment(repo: RepoRef, number: number, body: string): Promise<{ databaseId: number }>;
  merge(repo: RepoRef, number: number, method: MergeMethod): Promise<void>;
}

/** `owner/name`, `https://github.com/owner/name(.git)` or `git@github.com:owner/name.git`. */
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

// --- the snapshot query -------------------------------------------------------------

const AUTHOR = `author { login __typename }`;

const SNAPSHOT_QUERY = `query PullSnapshot($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id number url title body state isDraft merged mergeable
      headRefName headRefOid baseRefName isCrossRepository
      ${AUTHOR}
      reviews(last: 50) { nodes { id state body submittedAt authorAssociation ${AUTHOR} } }
      reviewThreads(first: 100) {
        nodes {
          id path line isResolved isOutdated
          comments(first: 50) { nodes { id databaseId body createdAt authorAssociation ${AUTHOR} } }
        }
      }
      comments(last: 50) { nodes { id databaseId body createdAt authorAssociation ${AUTHOR} } }
      commits(last: 1) {
        nodes { commit { oid statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion startedAt completedAt detailsUrl databaseId }
          ... on StatusContext { context state createdAt targetUrl }
        } } } } }
      }
    }
  }
}`;

interface RawAuthor {
  login?: string;
  __typename?: string;
}

interface RawComment {
  id: string;
  databaseId: number;
  body: string;
  createdAt: string;
  authorAssociation: string;
  author: RawAuthor | null;
}

interface RawContext {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  status?: string;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
  databaseId?: number | null;
  context?: string;
  state?: string;
  createdAt?: string;
  targetUrl?: string | null;
}

interface RawSnapshot {
  repository: {
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    pullRequest: {
      id: string;
      number: number;
      url: string;
      title: string;
      body: string;
      state: "OPEN" | "CLOSED" | "MERGED";
      isDraft: boolean;
      merged: boolean;
      mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
      headRefName: string;
      headRefOid: string;
      baseRefName: string;
      isCrossRepository: boolean;
      author: RawAuthor | null;
      reviews: {
        nodes: Array<{
          id: string;
          state: Review["state"];
          body: string;
          submittedAt: string;
          authorAssociation: string;
          author: RawAuthor | null;
        }>;
      };
      reviewThreads: {
        nodes: Array<{
          id: string;
          path: string;
          line: number | null;
          isResolved: boolean;
          isOutdated: boolean;
          comments: { nodes: RawComment[] };
        }>;
      };
      comments: { nodes: RawComment[] };
      commits: {
        nodes: Array<{
          commit: { oid: string; statusCheckRollup: { contexts: { nodes: RawContext[] } } | null };
        }>;
      };
    } | null;
  } | null;
}

function author(raw: RawAuthor | null, association: string): Author {
  return {
    login: raw?.login ?? "ghost",
    // A GitHub App's author is a `Bot`; a deleted account is null.
    type: raw?.__typename === "Bot" ? "bot" : "user",
    association,
  };
}

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

/** One check run or commit status, as Code reads it. */
export function checkOf(raw: RawContext): Check {
  if (raw.__typename === "StatusContext") {
    const state =
      raw.state === "SUCCESS"
        ? "success"
        : raw.state === "FAILURE" || raw.state === "ERROR"
          ? "failure"
          : "pending";
    return {
      name: raw.context ?? "status",
      state,
      startedAt: raw.createdAt ?? null,
      completedAt: state === "pending" ? null : (raw.createdAt ?? null),
      url: raw.targetUrl ?? null,
      jobId: null,
    };
  }
  const state: CheckState =
    raw.status !== "COMPLETED"
      ? "pending"
      : raw.conclusion === "SUCCESS"
        ? "success"
        : FAILED_CONCLUSIONS.has(raw.conclusion ?? "")
          ? "failure"
          : // NEUTRAL, SKIPPED, STALE, CANCELLED (a newer push cancels the run).
            "neutral";
  const jobId =
    raw.databaseId && raw.detailsUrl && /\/actions\/runs\/\d+\/job\//.test(raw.detailsUrl)
      ? raw.databaseId
      : null;
  return {
    name: raw.name ?? "check",
    state,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    url: raw.detailsUrl ?? null,
    jobId,
  };
}

function comment(raw: RawComment): ReviewComment {
  return {
    id: raw.id,
    databaseId: raw.databaseId,
    author: author(raw.author, raw.authorAssociation),
    body: raw.body,
    createdAt: raw.createdAt,
  };
}

/** The snapshot query's answer, as a `PullSnapshot` (exported for tests on recorded output). */
export function toSnapshot(raw: RawSnapshot): PullSnapshot {
  const repo = raw.repository;
  const pr = repo?.pullRequest;
  if (!repo || !pr) throw new GitHubError("No such pull request", 404);
  const head = pr.commits.nodes[0]?.commit;
  const methods: MergeMethod[] = [];
  if (repo.mergeCommitAllowed) methods.push("merge");
  if (repo.squashMergeAllowed) methods.push("squash");
  if (repo.rebaseMergeAllowed) methods.push("rebase");
  return {
    id: pr.id,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    body: pr.body,
    state:
      pr.merged || pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open",
    draft: pr.isDraft,
    headRef: pr.headRefName,
    headSha: head?.oid ?? pr.headRefOid,
    baseRef: pr.baseRefName,
    fromFork: pr.isCrossRepository,
    mergeable:
      pr.mergeable === "MERGEABLE"
        ? "mergeable"
        : pr.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    mergeMethods: methods,
    author: pr.author?.login ?? null,
    checks: (head?.statusCheckRollup?.contexts.nodes ?? []).map(checkOf),
    reviews: pr.reviews.nodes.map((r) => ({
      id: r.id,
      author: author(r.author, r.authorAssociation),
      state: r.state,
      body: r.body,
      submittedAt: r.submittedAt,
    })),
    threads: pr.reviewThreads.nodes.map((t) => ({
      id: t.id,
      path: t.path,
      line: t.line,
      resolved: t.isResolved,
      outdated: t.isOutdated,
      comments: t.comments.nodes.map(comment),
    })),
    comments: pr.comments.nodes.map(comment),
  };
}

const enc = encodeURIComponent;
const repoPath = (repo: RepoRef) => `/repos/${enc(repo.owner)}/${enc(repo.name)}`;

export function createGitHubClient(api: GitHubApi): GitHubClient {
  return {
    transport: api.kind,
    async viewer() {
      const data = await api.graphql<{ viewer: { login: string } }>(`query { viewer { login } }`);
      return { login: data.viewer.login };
    },
    async repository(repo) {
      const data = await api.graphql<{
        repository: { defaultBranchRef: { name: string } | null; isPrivate: boolean } | null;
      }>(
        `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { isPrivate defaultBranchRef { name } } }`,
        { owner: repo.owner, name: repo.name },
      );
      if (!data.repository) throw new GitHubError(`No access to ${repoSlug(repo)}`, 404);
      return {
        defaultBranch: data.repository.defaultBranchRef?.name ?? "main",
        private: data.repository.isPrivate,
      };
    },
    async openPullForBranch(repo, branch) {
      const data = await api.graphql<{
        repository: { pullRequests: { nodes: Array<{ number: number; url: string }> } } | null;
      }>(
        `query($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { pullRequests(headRefName: $head, states: [OPEN], first: 1) { nodes { number url } } } }`,
        { owner: repo.owner, name: repo.name, head: branch },
      );
      return data.repository?.pullRequests.nodes[0];
    },
    async createPull(repo, input) {
      const pr = await api.rest<{ number: number; html_url: string }>(
        "POST",
        `${repoPath(repo)}/pulls`,
        { body: input },
      );
      return { number: pr.number, url: pr.html_url };
    },
    async snapshot(repo, number) {
      return toSnapshot(
        await api.graphql<RawSnapshot>(SNAPSHOT_QUERY, {
          owner: repo.owner,
          name: repo.name,
          number,
        }),
      );
    },
    async jobLogTail(repo, jobId, maxChars) {
      const log = await api.rest<string>("GET", `${repoPath(repo)}/actions/jobs/${jobId}/logs`, {
        text: true,
      });
      return log.length > maxChars ? log.slice(-maxChars) : log;
    },
    async replyToThread(threadId, body) {
      const data = await api.graphql<{
        addPullRequestReviewThreadReply: { comment: { databaseId: number | null } | null };
      }>(
        `mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { databaseId } } }`,
        { thread: threadId, body },
      );
      return { databaseId: data.addPullRequestReviewThreadReply.comment?.databaseId ?? null };
    },
    async resolveThread(threadId) {
      await api.graphql(
        `mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { id } } }`,
        { thread: threadId },
      );
    },
    async comment(repo, number, body) {
      const created = await api.rest<{ id: number }>(
        "POST",
        `${repoPath(repo)}/issues/${number}/comments`,
        { body: { body } },
      );
      return { databaseId: created.id };
    },
    async merge(repo, number, method) {
      await api.rest("PUT", `${repoPath(repo)}/pulls/${number}/merge`, {
        body: { merge_method: method },
      });
    },
  };
}
