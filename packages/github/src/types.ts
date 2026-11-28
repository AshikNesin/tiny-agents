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

export interface JobProgress {
  completed: boolean;
  steps: JobStep[];
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

export interface InboxFilter {
  updatedSince?: string;
  repos?: RepoRef[];
  drafts?: boolean;
  direct?: boolean;
}
