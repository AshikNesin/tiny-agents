import { parseEach } from "@tiny-agents/std";
import { z } from "zod";
import { GitHubError, type GitHubApi } from "./api";

type ReportInvalid = (what: string, problem: string) => void;

const each =
  (what: string, report: ReportInvalid) =>
  <T>(schema: z.ZodType<T>) =>
    z
      .array(z.unknown())
      .transform((values) => parseEach(values, schema, (_value, problem) => report(what, problem)));

export interface RepoRef {
  owner: string;
  name: string;
}

export type AuthorType = "user" | "bot";
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
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
  jobId: number | null;
}

export interface Review {
  id: string;
  author: Author;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string;
  submittedAt: string;
  commit?: string | null;
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
  startLine?: number | null;
  side?: "LEFT" | "RIGHT";
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
  fromFork: boolean;
  headRepo: RepoRef | null;
  maintainerCanModify: boolean;
  mergeable: "mergeable" | "conflicting" | "unknown";
  mergeMethods: MergeMethod[];
  inMergeQueue: boolean;
  queueRemovals: Array<{ id: string; at: string; reason: string }>;
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

export interface JobStep {
  number: number;
  name: string;
  state: "queued" | "running" | "success" | "failure" | "skipped";
}

interface JobProgress {
  completed: boolean;
  steps: JobStep[];
}

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

export interface ReviewCommentInput {
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startLine?: number;
  body: string;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface InboxPull {
  reason: "requested" | "reviewed" | "authored";
  repo: RepoRef;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  headSha: string;
  decision: "approved" | "changes_requested" | "review_required" | null;
  lastReview: { at: string; commit: string | null } | null;
  bot: boolean;
}

const INBOX_PULL = `fragment InboxPull on PullRequest {
  number title url isDraft updatedAt headRefOid reviewDecision
  repository { owner { login } name }
  author { login __typename }
  reviews(author: $login, last: 1) { nodes { submittedAt commit { oid } } }
}`;

const INBOX_QUERY = `query ReviewInbox($login: String!, $requested: String!, $reviewed: String!, $authored: String!) {
  requested: search(query: $requested, type: ISSUE, first: 50) { nodes { ...InboxPull } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 50) { nodes { ...InboxPull } }
  authored: search(query: $authored, type: ISSUE, first: 50) { nodes { ...InboxPull } }
}
${INBOX_PULL}`;

export interface InboxFilter {
  updatedSince?: string;
  repos?: RepoRef[];
  drafts?: boolean;
  direct?: boolean;
}

const BOT_LOGIN = /(?:[-_]bot|\[bot\])$/i;

const isBotAuthor = (author: { login: string; __typename?: string } | null) =>
  author?.__typename === "Bot" || (author ? BOT_LOGIN.test(author.login) : false);

const INBOX_SEARCHES = {
  requested: "review-requested:@me",
  reviewed: "reviewed-by:@me -author:@me",
  authored: "author:@me",
} as const;

const SEARCH_MAX = 256;

function inboxSearches(filter: InboxFilter): Record<keyof typeof INBOX_SEARCHES, string> {
  const narrow = [
    filter.updatedSince ? `updated:>=${filter.updatedSince}` : "",
    filter.drafts === false ? "draft:false" : "",
  ].filter(Boolean);
  const repos = (filter.repos ?? []).map((r) => `repo:${repoSlug(r)}`);
  const searches: Record<keyof typeof INBOX_SEARCHES, string> = filter.direct
    ? { ...INBOX_SEARCHES, requested: "user-review-requested:@me" }
    : INBOX_SEARCHES;
  const build = (who: string, withRepos: boolean) =>
    [
      "is:open is:pr archived:false",
      who,
      ...narrow,
      ...(withRepos ? repos : []),
      "sort:updated-desc",
    ].join(" ");
  const out = {} as Record<keyof typeof INBOX_SEARCHES, string>;
  for (const [key, who] of Object.entries(searches) as Array<
    [keyof typeof INBOX_SEARCHES, string]
  >) {
    const full = build(who, repos.length > 0);
    out[key] = full.length <= SEARCH_MAX ? full : build(who, false);
  }
  return out;
}

const viewerSchema = z.looseObject({ viewer: z.looseObject({ login: z.string() }) });

const rawInboxPullSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    isDraft: z.boolean(),
    updatedAt: z.string(),
    headRefOid: z.string(),
    reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
    repository: z.looseObject({ owner: z.looseObject({ login: z.string() }), name: z.string() }),
    author: z.looseObject({ login: z.string(), __typename: z.string().optional() }).nullable(),
    reviews: z.looseObject({
      nodes: each(
        "a pull request's review",
        report,
      )(
        z.looseObject({
          submittedAt: z.string().nullable(),
          commit: z.looseObject({ oid: z.string() }).nullable(),
        }),
      ),
    }),
  });

const notAPull = (): null => null;

const inboxNodesSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    nodes: each(
      "a review inbox entry",
      report,
    )(z.union([rawInboxPullSchemaOf(report), z.strictObject({}).transform(notAPull)])),
  });

const inboxSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    requested: inboxNodesSchemaOf(report),
    reviewed: inboxNodesSchemaOf(report),
    authored: inboxNodesSchemaOf(report),
  });

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

const AUTHOR = `author { login __typename }`;

const SNAPSHOT_QUERY = `query PullSnapshot($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id number url title body state isDraft merged mergeable
      headRefName headRefOid baseRefName isCrossRepository isInMergeQueue
      maintainerCanModify headRepository { name owner { login } }
      timelineItems(last: 5, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes { ... on RemovedFromMergeQueueEvent { id createdAt reason } }
      }
      ${AUTHOR}
      reviews(last: 50) { nodes { id state body submittedAt authorAssociation ${AUTHOR} commit { oid } } }
      reviewThreads(first: 100) {
        nodes {
          id path line startLine diffSide isResolved isOutdated
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

const rawAuthorSchema = z
  .looseObject({ login: z.string().optional(), __typename: z.string().optional() })
  .nullable();

type RawAuthor = z.infer<typeof rawAuthorSchema>;

const rawCommentSchema = z.looseObject({
  id: z.string(),
  databaseId: z.number(),
  body: z.string(),
  createdAt: z.string(),
  authorAssociation: z.string(),
  author: rawAuthorSchema,
});

type RawComment = z.infer<typeof rawCommentSchema>;

const rawCommentsSchema = z.looseObject({ nodes: z.array(rawCommentSchema) });

const rawContextSchema = z.looseObject({
  __typename: z.enum(["CheckRun", "StatusContext"]),
  name: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullish(),
  startedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  detailsUrl: z.string().nullish(),
  databaseId: z.number().nullish(),
  context: z.string().optional(),
  state: z.string().optional(),
  createdAt: z.string().optional(),
  targetUrl: z.string().nullish(),
});

type RawContext = z.infer<typeof rawContextSchema>;

const rawPullSchema = z.looseObject({
  id: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  isCrossRepository: z.boolean(),
  maintainerCanModify: z.boolean().optional(),
  headRepository: z
    .looseObject({ name: z.string(), owner: z.looseObject({ login: z.string() }) })
    .nullish(),
  isInMergeQueue: z.boolean().optional(),
  timelineItems: z
    .looseObject({
      nodes: z.array(
        z.looseObject({
          id: z.string().optional(),
          createdAt: z.string().optional(),
          reason: z.string().nullish(),
        }),
      ),
    })
    .optional(),
  author: rawAuthorSchema,
  reviews: z.looseObject({
    nodes: z.array(
      z.looseObject({
        id: z.string(),
        state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
        body: z.string(),
        submittedAt: z.string().nullable(),
        authorAssociation: z.string(),
        author: rawAuthorSchema,
        commit: z.looseObject({ oid: z.string() }).nullish(),
      }),
    ),
  }),
  reviewThreads: z.looseObject({
    nodes: z.array(
      z.looseObject({
        id: z.string(),
        path: z.string(),
        line: z.number().nullable(),
        startLine: z.number().nullish(),
        diffSide: z.enum(["LEFT", "RIGHT"]).optional(),
        isResolved: z.boolean(),
        isOutdated: z.boolean(),
        comments: rawCommentsSchema,
      }),
    ),
  }),
  comments: rawCommentsSchema,
  commits: z.looseObject({
    nodes: z.array(
      z.looseObject({
        commit: z.looseObject({
          oid: z.string(),
          statusCheckRollup: z
            .looseObject({
              contexts: z.looseObject({ nodes: z.array(rawContextSchema) }),
            })
            .nullable(),
        }),
      }),
    ),
  }),
});

const rawSnapshotSchema = z.looseObject({
  repository: z
    .looseObject({
      mergeCommitAllowed: z.boolean(),
      squashMergeAllowed: z.boolean(),
      rebaseMergeAllowed: z.boolean(),
      pullRequest: rawPullSchema.nullable(),
    })
    .nullable(),
});

type RawSnapshot = z.infer<typeof rawSnapshotSchema>;

function author(raw: RawAuthor, association: string): Author {
  return {
    login: raw?.login ?? "ghost",
    type: raw?.__typename === "Bot" ? "bot" : "user",
    association,
  };
}

const FAILED_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

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
          : "neutral";
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

function latestRuns(checks: Check[]): Check[] {
  const latest = new Map<string, Check>();
  for (const check of checks) {
    const seen = latest.get(check.name);
    if (!seen || newer(check, seen)) latest.set(check.name, check);
  }
  const order = [...new Set(checks.map((c) => c.name))];
  return order.map((name) => latest.get(name)!);
}

function newer(a: Check, b: Check): boolean {
  if (a.startedAt && b.startedAt && a.startedAt !== b.startedAt) return a.startedAt > b.startedAt;
  if (!a.startedAt !== !b.startedAt) return !a.startedAt;
  return (a.jobId ?? 0) > (b.jobId ?? 0);
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
    headRepo: pr.headRepository
      ? { owner: pr.headRepository.owner.login, name: pr.headRepository.name }
      : null,
    maintainerCanModify: pr.maintainerCanModify ?? false,
    mergeable:
      pr.mergeable === "MERGEABLE"
        ? "mergeable"
        : pr.mergeable === "CONFLICTING"
          ? "conflicting"
          : "unknown",
    mergeMethods: methods,
    author: pr.author?.login ?? null,
    checks: latestRuns((head?.statusCheckRollup?.contexts.nodes ?? []).map(checkOf)),
    reviews: pr.reviews.nodes.map((r) => ({
      id: r.id,
      author: author(r.author, r.authorAssociation),
      state: r.state,
      body: r.body,
      submittedAt: r.submittedAt ?? "",
      commit: r.commit?.oid ?? null,
    })),
    threads: pr.reviewThreads.nodes.map((t) => ({
      id: t.id,
      path: t.path,
      line: t.line,
      startLine: t.startLine ?? null,
      side: t.diffSide ?? "RIGHT",
      resolved: t.isResolved,
      outdated: t.isOutdated,
      comments: t.comments.nodes.map(comment),
    })),
    comments: pr.comments.nodes.map(comment),
    inMergeQueue: Boolean(pr.isInMergeQueue),
    queueRemovals: (pr.timelineItems?.nodes ?? [])
      .filter((n) => n.id && n.createdAt)
      .map((n) => ({ id: n.id!, at: n.createdAt!, reason: n.reason ?? "" })),
  };
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
      const keep = filter.repos?.length
        ? new Set(filter.repos.map((r) => repoSlug(r).toLowerCase()))
        : null;
      const seen = new Set<string>();
      const out: InboxPull[] = [];
      for (const reason of ["requested", "reviewed", "authored"] as const) {
        for (const node of data[reason].nodes) {
          if (!node) continue;
          const slug = `${node.repository.owner.login}/${node.repository.name}`;
          if (keep && !keep.has(slug.toLowerCase())) continue;
          const key = `${slug}#${node.number}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const last = node.reviews.nodes[0];
          out.push({
            reason,
            repo: { owner: node.repository.owner.login, name: node.repository.name },
            number: node.number,
            title: node.title,
            url: node.url,
            author: node.author?.login ?? "ghost",
            draft: node.isDraft,
            updatedAt: node.updatedAt,
            headSha: node.headRefOid,
            decision: node.reviewDecision
              ? (node.reviewDecision.toLowerCase() as InboxPull["decision"])
              : null,
            lastReview: last?.submittedAt
              ? { at: last.submittedAt, commit: last.commit?.oid ?? null }
              : null,
            bot: isBotAuthor(node.author),
          });
        }
      }
      return out;
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
