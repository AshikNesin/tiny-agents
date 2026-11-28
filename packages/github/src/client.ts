import { z } from "zod";
import { GitHubError, type GitHubApi } from "./api";
import { inboxPulls, inboxSchemaOf, inboxSearches, INBOX_QUERY } from "./inbox";
import { each, type ReportInvalid } from "./parse";
import { repoSlug } from "./repo";
import { rawSnapshotSchema, SNAPSHOT_QUERY, toSnapshot } from "./snapshot";
import type {
  InboxFilter,
  InboxPull,
  JobProgress,
  JobStep,
  MergeMethod,
  PullRef,
  PullSnapshot,
  RepoRef,
  ReviewCommentInput,
  ReviewEvent,
} from "./types";

const rawJobSchema = z.looseObject({
  status: z.string(),
  steps: z
    .array(
      z.looseObject({
        number: z.number(),
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
      }),
    )
    .optional(),
});

type RawJob = z.infer<typeof rawJobSchema>;

function stepState(step: NonNullable<RawJob["steps"]>[number]): JobStep["state"] {
  if (step.status === "in_progress") return "running";
  if (step.status !== "completed") return "queued";
  if (step.conclusion === "success") return "success";
  if (step.conclusion === "skipped") return "skipped";
  return "failure";
}

const viewerSchema = z.looseObject({ viewer: z.looseObject({ login: z.string() }) });
const repositorySchema = z.looseObject({
  repository: z
    .looseObject({
      defaultBranchRef: z.looseObject({ name: z.string() }).nullable(),
      isPrivate: z.boolean(),
    })
    .nullable(),
});

const openPullsSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    repository: z
      .looseObject({
        pullRequests: z.looseObject({
          nodes: each(
            "an open pull request",
            report,
          )(z.looseObject({ number: z.number(), url: z.string() })),
        }),
      })
      .nullable(),
  });

const createdPullSchema = z.looseObject({ number: z.number(), html_url: z.string() });

const threadReplySchema = z.looseObject({
  addPullRequestReviewThreadReply: z.looseObject({
    comment: z.looseObject({ databaseId: z.number().nullable() }).nullable(),
  }),
});

const issueSchema = z.looseObject({
  title: z.string().optional(),
  body: z.string().nullish(),
  user: z.looseObject({ login: z.string().optional() }).nullish(),
});

const createdCommentSchema = z.looseObject({ id: z.number() });

const createdReviewSchema = z.looseObject({ html_url: z.string() });

export interface GitHubClient {
  readonly transport: GitHubApi["kind"];
  viewer(): Promise<{ login: string }>;
  repository(repo: RepoRef): Promise<{ defaultBranch: string; private: boolean }>;
  openPullForBranch(repo: RepoRef, branch: string): Promise<PullRef | undefined>;
  createPull(
    repo: RepoRef,
    input: { head: string; base: string; title: string; body: string; draft: boolean },
  ): Promise<PullRef>;
  snapshot(repo: RepoRef, number: number): Promise<PullSnapshot>;
  job(repo: RepoRef, jobId: number): Promise<JobProgress>;
  jobLogTail(repo: RepoRef, jobId: number, maxChars: number): Promise<string>;
  replyToThread(threadId: string, body: string): Promise<{ databaseId: number | null }>;
  resolveThread(threadId: string): Promise<void>;
  comment(repo: RepoRef, number: number, body: string): Promise<{ databaseId: number }>;
  issue(repo: RepoRef, number: number): Promise<{ title: string; body: string; author: string }>;
  reviewInbox(filter?: InboxFilter): Promise<InboxPull[]>;
  submitReview(
    repo: RepoRef,
    number: number,
    review: { commitId: string; event: ReviewEvent; body: string; comments: ReviewCommentInput[] },
  ): Promise<{ url: string }>;
  merge(repo: RepoRef, number: number, method: MergeMethod): Promise<void>;
  updatePull(
    repo: RepoRef,
    number: number,
    change: { title?: string; body?: string },
  ): Promise<void>;
  markReady(pullId: string): Promise<void>;
  convertToDraft(pullId: string): Promise<void>;
}

const enc = encodeURIComponent;
const repoPath = (repo: RepoRef) => `/repos/${enc(repo.owner)}/${enc(repo.name)}`;

export function createGitHubClient(api: GitHubApi, report: ReportInvalid): GitHubClient {
  return {
    transport: api.kind,
    async viewer() {
      const data = await api.graphql(viewerSchema, `query { viewer { login } }`);
      return { login: data.viewer.login };
    },
    async reviewInbox(filter = {}) {
      const { viewer } = await api.graphql(viewerSchema, `query { viewer { login } }`);
      const login = viewer.login;
      const data = await api.graphql(inboxSchemaOf(report), INBOX_QUERY, {
        login,
        ...inboxSearches(filter),
      });
      return inboxPulls(data, filter);
    },
    async repository(repo) {
      const data = await api.graphql(
        repositorySchema,
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
      const data = await api.graphql(
        openPullsSchemaOf(report),
        `query($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { pullRequests(headRefName: $head, states: [OPEN], first: 1) { nodes { number url } } } }`,
        { owner: repo.owner, name: repo.name, head: branch },
      );
      return data.repository?.pullRequests.nodes[0];
    },
    async createPull(repo, input) {
      const pr = await api.rest(createdPullSchema, "POST", `${repoPath(repo)}/pulls`, {
        body: input,
      });
      return { number: pr.number, url: pr.html_url };
    },
    async snapshot(repo, number) {
      return toSnapshot(
        await api.graphql(rawSnapshotSchema, SNAPSHOT_QUERY, {
          owner: repo.owner,
          name: repo.name,
          number,
        }),
      );
    },
    async job(repo, jobId) {
      const job = await api.rest(rawJobSchema, "GET", `${repoPath(repo)}/actions/jobs/${jobId}`);
      return {
        completed: job.status === "completed",
        steps: (job.steps ?? []).map((step) => ({
          number: step.number,
          name: step.name,
          state: stepState(step),
        })),
      };
    },
    async jobLogTail(repo, jobId, maxChars) {
      const log = await api.text("GET", `${repoPath(repo)}/actions/jobs/${jobId}/logs`);
      return log.length > maxChars ? log.slice(-maxChars) : log;
    },
    async replyToThread(threadId, body) {
      const data = await api.graphql(
        threadReplySchema,
        `mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { databaseId } } }`,
        { thread: threadId, body },
      );
      return { databaseId: data.addPullRequestReviewThreadReply.comment?.databaseId ?? null };
    },
    async resolveThread(threadId) {
      await api.graphql(
        z.unknown(),
        `mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { id } } }`,
        { thread: threadId },
      );
    },
    async issue(repo, number) {
      const found = await api.rest(issueSchema, "GET", `${repoPath(repo)}/issues/${number}`);
      return {
        title: found.title ?? "",
        body: found.body ?? "",
        author: found.user?.login ?? "",
      };
    },
    async comment(repo, number, body) {
      const created = await api.rest(
        createdCommentSchema,
        "POST",
        `${repoPath(repo)}/issues/${number}/comments`,
        { body: { body } },
      );
      return { databaseId: created.id };
    },
    async submitReview(repo, number, review) {
      const created = await api.rest(
        createdReviewSchema,
        "POST",
        `${repoPath(repo)}/pulls/${number}/reviews`,
        {
          body: {
            commit_id: review.commitId,
            event: review.event,
            body: review.body,
            comments: review.comments.map((c) => ({
              path: c.path,
              body: c.body,
              line: c.line,
              side: c.side,
              ...(c.startLine !== undefined && c.startLine !== c.line
                ? { start_line: c.startLine, start_side: c.side }
                : {}),
            })),
          },
        },
      );
      return { url: created.html_url };
    },
    async merge(repo, number, method) {
      await api.rest(z.unknown(), "PUT", `${repoPath(repo)}/pulls/${number}/merge`, {
        body: { merge_method: method },
      });
    },
    async updatePull(repo, number, change) {
      await api.rest(z.unknown(), "PATCH", `${repoPath(repo)}/pulls/${number}`, { body: change });
    },
    async markReady(pullId) {
      await api.graphql(
        z.unknown(),
        `mutation($pr: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $pr }) { clientMutationId } }`,
        { pr: pullId },
      );
    },
    async convertToDraft(pullId) {
      await api.graphql(
        z.unknown(),
        `mutation($pr: ID!) { convertPullRequestToDraft(input: { pullRequestId: $pr }) { clientMutationId } }`,
        { pr: pullId },
      );
    },
  };
}
