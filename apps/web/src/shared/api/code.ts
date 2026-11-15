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
  triggers: { checks: boolean; reviews: boolean; conflicts: boolean };
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
  /** Paths a pass may not push changes to (globs). */
  protectedPaths: string[];
  autofix: AutofixProjectSettings;
}

export interface ProjectView {
  id: string;
  name: string;
  repo: { owner: string; name: string };
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
  /** The last snapshot, what the tab shows; null before the first sync. */
  snapshot: PullSnapshot | null;
  /** Checks pending longer than the stall limit. */
  stalled: string[];
  /** Comment and thread ids from authors Auto-fix does not take instructions from. */
  ignored: string[];
  passes: PassView[];
}

/** The PR tab of one thread. */
export interface ThreadPullsView {
  project: ProjectView | null;
  branch: string | null;
  active: PullView | null;
  earlier: Array<{ number: number; url: string; title: string; state: PullView["state"] }>;
  /** Commits on the branch not on the base yet (what Publish would push). */
  ahead: number | null;
}

export interface ReviewFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
  hash: string;
  viewed: boolean;
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
