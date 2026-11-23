import type { ThreadPullsView } from "../../../shared/api/code";

export type PullStage =
  | { kind: "none" }
  | { kind: "nothing" }
  | { kind: "create"; commits: number; uncommitted: number }
  | { kind: "open"; number: number; uncommitted: number; ready: boolean }
  | { kind: "merged"; number: number; url: string; title: string };

const SETTLED = new Set(["success", "neutral", "skipped"]);

export function pullStage(view: ThreadPullsView): PullStage {
  if (!view.project) return { kind: "none" };
  const commits = view.ahead ?? 0;
  const uncommitted = view.uncommitted ?? 0;
  const pr = view.active;
  if (pr) {
    const snapshot = pr.snapshot;
    const ready =
      !pr.draft &&
      snapshot?.mergeable === "mergeable" &&
      snapshot.checks.every((check) => SETTLED.has(check.state));
    return { kind: "open", number: pr.number, uncommitted, ready };
  }
  if (commits > 0 || uncommitted > 0) return { kind: "create", commits, uncommitted };
  const last = view.earlier[0];
  if (last?.state === "merged") {
    return { kind: "merged", number: last.number, url: last.url, title: last.title };
  }
  return { kind: "nothing" };
}

export type NextStepId = "create-pr" | "review" | "push" | "merge" | "open-pr" | "archive";

export interface NextStep {
  id: NextStepId;
  label: string;
  primary?: boolean;
}

const ARCHIVE: NextStep = { id: "archive", label: "Archive" };

export function nextSteps(stage: PullStage): NextStep[] {
  switch (stage.kind) {
    case "none":
      return [];
    case "nothing":
      return [ARCHIVE];
    case "create":
      return [
        {
          id: "create-pr",
          label: stage.uncommitted > 0 ? "Commit and create PR" : "Create PR",
          primary: true,
        },
        { id: "review", label: "Review changes" },
        ARCHIVE,
      ];
    case "open": {
      const pr: NextStep = { id: "open-pr", label: `PR #${stage.number}` };
      if (stage.uncommitted > 0)
        return [{ id: "push", label: "Commit and push", primary: true }, pr, ARCHIVE];
      if (stage.ready)
        return [{ id: "merge", label: `Merge #${stage.number}`, primary: true }, pr, ARCHIVE];
      return [pr, ARCHIVE];
    }
    case "merged":
      return [{ ...ARCHIVE, primary: true }];
  }
}
