import { z } from "zod";
import { GitHubError } from "./api";
import type { Author, Check, CheckState, MergeMethod, PullSnapshot, ReviewComment } from "./types";

const AUTHOR = `author { login __typename }`;

export const SNAPSHOT_QUERY = `query PullSnapshot($owner: String!, $name: String!, $number: Int!) {
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

export const rawSnapshotSchema = z.looseObject({
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
