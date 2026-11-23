import type { MergeMethod, PullSnapshot } from "@tiny-agents/github";
import type { AutofixStatus } from "../machines/autofix";
import type { AutofixPassStatus } from "../machines/autofix-pass";

export type { MergeMethod };

interface ProjectScripts {
  setup?: string;
  check?: string;
  archive?: string;
}

interface AutofixProjectSettings {
  triggers: { checks: boolean; reviews: boolean; conflicts: boolean };
  trustedBots: string[];
  hourlyLimit: number;
  noOwnerLimit: number;
  passMinutes: number;
  onByDefault: boolean;
}

export interface ProjectSettings {
  scripts: ProjectScripts;
  archiveOnMerge: boolean;
  draftPulls: boolean;
  branchPrefix: string;
  protectedPaths: string[];
  workflowInstructions: string;
  autofix: AutofixProjectSettings;
}

export interface WorktreeFile {
  path: string;
  content: string | null;
}

export interface FileHit {
  path: string;
  line: number;
  text: string;
}

export interface ProjectView {
  id: string;
  name: string;
  repo: { owner: string; name: string };
  transport: "gh" | "app";
  baseBranch: string;
  checkoutPath: string;
  defaultInstanceId: string | null;
  defaultModel: string | null;
  settings: ProjectSettings;
  createdAt: string;
}

export interface ProjectCreateBody {
  repo: string;
  transport?: "gh" | "app";
  name?: string;
  baseBranch?: string;
  defaultInstanceId?: string;
  defaultModel?: string;
}

export interface ProjectUpdateBody {
  name?: string;
  baseBranch?: string;
  defaultInstanceId?: string | null;
  defaultModel?: string | null;
  settings?: Partial<Omit<ProjectSettings, "autofix">> & {
    autofix?: Partial<Omit<AutofixProjectSettings, "triggers">> & {
      triggers?: Partial<AutofixProjectSettings["triggers"]>;
    };
  };
}

export interface GitHubStatus {
  credential: "token" | "gh";
  tokenHandle: string | null;
  app: { slug: string; name: string; webhooks: boolean } | null;
  sandbox: boolean;
  tools: { git: boolean; gh: boolean } | null;
  login: string | null;
  error: string | null;
}

interface PassView {
  id: string;
  trigger: string;
  status: AutofixPassStatus;
  outcome: string | null;
  detail: string | null;
  items: Array<{ id: string; title: string }>;
  pushedSha: string | null;
  costUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface PullView {
  id: string;
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headRef: string;
  baseRef: string;
  syncedAt: string | null;
  autofix: boolean;
  loop: { status: AutofixStatus; reason: string | null };
  yolo: { method: MergeMethod; waiting: string | null } | null;
  snapshot: PullSnapshot | null;
  stalled: string[];
  ignored: string[];
  passes: PassView[];
}

export interface CheckLogView {
  name: string;
  url: string | null;
  summary: string | null;
  lines: string[];
  highlight: number[];
  running: CheckStepView[] | null;
}

export interface CheckStepView {
  number: number;
  name: string;
  state: "queued" | "running" | "success" | "failure" | "skipped";
}

export interface ThreadPullsView {
  project: ProjectView | null;
  branch: string | null;
  active: PullView | null;
  earlier: Array<{ number: number; url: string; title: string; state: PullView["state"] }>;
  ahead: number | null;
  uncommitted: number | null;
  landed: "github" | "local" | null;
}

export interface ReviewFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
  binary?: boolean;
  hash: string;
  viewed: boolean;
}

export interface ReviewFileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  unshowable?: "binary" | "tooLarge";
}

export interface ReviewDraft {
  id: string;
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  quote: string;
  body: string;
  createdAt: string;
}

export interface ReviewDraftBody {
  path: string;
  side?: "old" | "new";
  startLine: number;
  endLine: number;
  quote?: string;
  body: string;
}

export interface CheckpointView {
  id: string;
  seq: number;
  reason: "start" | "turn" | "before_revert";
  headSha: string;
  createdAt: string;
}

export interface PullReviewView {
  id: string;
  key: string;
  projectId: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  fromFork: boolean;
  mine: boolean;
  reviewedSha: string | null;
  threadId: string | null;
  codingThreadId: string | null;
  worktreeThreadId: string | null;
  assistant: { instanceId: string; model: string | null } | null;
  archived: boolean;
  updatedAt: string;
  brief: string | null;
  reviewing: boolean;
  findings: FindingView[];
}

export interface FindingView {
  id: string;
  severity: "bug" | "test" | "nit" | "question";
  title: string;
  body: string;
  path: string;
  line: number;
  state: "open" | "added" | "dismissed";
}

export interface PullThreadView {
  id: string;
  path: string;
  side: "old" | "new";
  line: number | null;
  startLine: number | null;
  resolved: boolean;
  outdated: boolean;
  comments: Array<{ id: string; author: string; bot: boolean; body: string; createdAt: string }>;
}

export interface PullThreadsView {
  headSha: string;
  threads: PullThreadView[];
}

export interface InboxPullView {
  section: "needs" | "updated" | "waiting" | "mine";
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  decision: "approved" | "changes_requested" | "review_required" | null;
  lastReviewAt: string | null;
  projectId: string | null;
  reviewId: string | null;
}

export interface InboxQuery {
  days?: number;
  repo?: string;
  drafts?: "hide";
}

export type ReviewVerdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface AskReviewBody {
  message: string;
  model?: string;
}

export interface SubmitReviewBody {
  event: ReviewVerdict;
  body?: string;
}

export interface PushedReview {
  sha: string;
  branch: string;
}

export interface SuggestedChanges {
  added: number;
  skipped: number;
}

export interface EditReviewFileBody {
  path: string;
  original: string;
  content: string;
}

export interface ReviewTerminal {
  name: string;
}

export interface EditorSshTarget {
  host: string | null;
  user: string | null;
  port: number | null;
  keyFile: string | null;
}
