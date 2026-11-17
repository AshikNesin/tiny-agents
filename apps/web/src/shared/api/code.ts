/**
 * Code projects, pull requests, Auto-fix and review: the wire types of
 * `server/api/code/code.projects.routes.ts` (issue #297). Thread and harness
 * types are the harness contracts (`@tiny-agents/code/contracts`).
 */
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
  triggers: { checks: boolean; reviews: boolean; conflicts: boolean; mergeQueue: boolean };
  /** One last review pass when the PR goes green. */
  finalCheck: boolean;
  /** New PRs start with GitHub's auto-merge on. */
  autoMergeByDefault: boolean;
  /** Review bots whose comments are instructions (by login). */
  trustedBots: string[];
  hourlyLimit: number;
  noOwnerLimit: number;
  passMinutes: number;
  /** New PRs start with Auto-fix on. */
  onByDefault: boolean;
}

export interface ProjectSettings {
  /** Overrides of the checked-in `.tiny-agents/code.json`. */
  scripts: ProjectScripts;
  archiveOnMerge: boolean;
  /** Put before a new thread's branch name: `ta/` by default, empty for none. */
  branchPrefix: string;
  /** Paths a pass may not push changes to (globs). */
  protectedPaths: string[];
  autofix: AutofixProjectSettings;
}

export interface ProjectView {
  id: string;
  name: string;
  repo: { owner: string; name: string };
  /** `gh`: the CLI on the sandbox or the vault token; `app`: the GitHub App's installation. */
  transport: "gh" | "app";
  baseBranch: string;
  checkoutPath: string;
  defaultInstanceId: string | null;
  defaultModel: string | null;
  settings: ProjectSettings;
  createdAt: string;
}

export interface ProjectCreateBody {
  /** `owner/name` or a GitHub URL. */
  repo: string;
  /** Reach it through the GitHub App (Projects → GitHub) instead of `gh` or the token. */
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
  /** The GitHub App, when one is set up; `webhooks` false means Code polls it. */
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
  /** What the pass cost (USD), where the harness reports cost. */
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
  /** The owner wants GitHub's auto-merge on for it. */
  autoMerge: boolean;
  loop: { status: AutofixStatus; reason: string | null };
  /** The last snapshot, what the tab shows; null before the first sync. */
  snapshot: PullSnapshot | null;
  /** Checks pending longer than the stall limit. */
  stalled: string[];
  /** Comment and thread ids from authors Auto-fix does not take instructions from. */
  ignored: string[];
  passes: PassView[];
}

/** A failing (or any) check's log, cut to the lines around what went wrong. */
export interface CheckLogView {
  name: string;
  /** The full log on GitHub. */
  url: string | null;
  /** The line that says what went wrong, when one does. */
  summary: string | null;
  /** The excerpt, without timestamps or color codes. */
  lines: string[];
  /** Indexes into `lines` that read as errors. */
  highlight: number[];
  /**
   * The job's steps while it still runs, when GitHub has no log to send yet;
   * null once it has finished and `lines` is its log.
   */
  running: CheckStepView[] | null;
}

/** One step of a running Actions job. */
export interface CheckStepView {
  /** Its place in the job, from GitHub (unique within the job). */
  number: number;
  name: string;
  state: "queued" | "running" | "success" | "failure" | "skipped";
}

/** The PR tab of one thread. */
export interface ThreadPullsView {
  project: ProjectView | null;
  branch: string | null;
  active: PullView | null;
  earlier: Array<{ number: number; url: string; title: string; state: PullView["state"] }>;
  /** Commits on the branch not on the base yet (what Publish would push). */
  ahead: number | null;
  /** What the thread has cost (where the harness reports it) and its Auto-fix spend limit. */
  spend: { usd: number | null; limitUsd: number | null };
}

export interface ReviewFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
  /** Git sees binary content: no line counts and no text diff. */
  binary?: boolean;
  hash: string;
  viewed: boolean;
}

/** One file's two sides in Review, or why they are not sent (binary, over 2 MB). */
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

/** One per-turn checkpoint of a project thread (newest first in lists). */
export interface CheckpointView {
  id: string;
  seq: number;
  reason: "start" | "turn" | "before_revert";
  headSha: string;
  createdAt: string;
}

/** `GET /code/threads/:id/next-prompt`: the owner's likely next message, or null. */
export interface NextPrompt {
  text: string | null;
}

/** A PR review (issue #345): any PR of a project's repository, checked out at its head. */
export interface PullReviewView {
  id: string;
  /** Where its viewed marks and early line comments are kept (`review:<id>`). */
  key: string;
  projectId: string;
  /** `owner/name`. */
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  fromFork: boolean;
  /** The owner opened this PR: GitHub lets them comment on it, not approve it. */
  mine: boolean;
  /** The assistant's thread, once the owner asked it something. */
  threadId: string | null;
  /** The Code thread that opened this PR, when one did: its comments can go there instead. */
  codingThreadId: string | null;
  archived: boolean;
  updatedAt: string;
}

/** A conversation on a PR's lines, as GitHub has it (issue #345). */
export interface PullThreadView {
  id: string;
  path: string;
  side: "old" | "new";
  /** Last line at the PR's head; null when the code moved on (outdated). */
  line: number | null;
  startLine: number | null;
  resolved: boolean;
  outdated: boolean;
  comments: Array<{ id: string; author: string; bot: boolean; body: string; createdAt: string }>;
}

/** `GET /code/reviews/:id/threads`: the conversations, and the head GitHub placed them at. */
export interface PullThreadsView {
  headSha: string;
  threads: PullThreadView[];
}

/**
 * One open PR in the owner's review inbox (`GET /code/reviews/inbox`):
 * `needs` asks for their review; `updated` has commits since their last
 * review; `waiting` is on the author since it; `mine` is their own.
 */
export interface InboxPullView {
  section: "needs" | "updated" | "waiting" | "mine";
  /** `owner/name`. */
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  decision: "approved" | "changes_requested" | "review_required" | null;
  lastReviewAt: string | null;
  /** Its repository's project, when it is one (a review needs one). */
  projectId: string | null;
  /** The open review of it here, if any. */
  reviewId: string | null;
}

/** How a PR review is submitted on GitHub. */
export type ReviewVerdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** `POST /code/reviews/:id/submit`. */
export interface SubmitReviewBody {
  event: ReviewVerdict;
  body?: string;
}
