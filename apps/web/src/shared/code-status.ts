import type { RunStatus } from "./machines/run";

type ThreadGroup = "needs-you" | "working" | "review" | "done";

export interface ThreadStatus {
  group: ThreadGroup;
  reason: string | null;
}

export interface ThreadFacts {
  working: boolean;
  attention: string | null;
  unread: boolean;
  lastRun: { status: RunStatus; workflow: string | null } | null;
  pull: { loop: string; number: number } | null;
}

const WORKFLOW_LABEL: Record<string, string> = {
  fix_ci: "Fix CI",
  address_comments: "Address comments",
  resolve_conflicts: "Resolve conflicts",
  fix_issue: "Fix issue",
  review_pr: "Review PR",
};

export function threadStatus(facts: ThreadFacts): ThreadStatus {
  if (facts.attention) return { group: "needs-you", reason: "asks you" };
  if (facts.working) {
    const workflow = facts.lastRun?.status === "running" ? facts.lastRun.workflow : null;
    return { group: "working", reason: workflow ? (WORKFLOW_LABEL[workflow] ?? workflow) : null };
  }
  if (facts.pull?.loop === "needs_input") return { group: "needs-you", reason: "pull request" };
  if (facts.lastRun?.status === "failed") return { group: "needs-you", reason: "failed" };
  if (facts.unread) {
    return {
      group: "needs-you",
      reason: facts.lastRun?.status === "stopped" ? "stopped" : "finished",
    };
  }
  if (facts.pull && facts.pull.loop !== "merged") {
    return { group: "review", reason: facts.pull.loop === "green" ? "checks pass" : null };
  }
  return { group: "done", reason: facts.pull?.loop === "merged" ? "merged" : null };
}
