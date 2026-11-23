import { describe, expect, it } from "vite-plus/test";
import { nextSteps, pullStage } from "@/lib/code/pull-stage";
import type { PullView, ThreadPullsView } from "../../../apps/web/src/shared/api/code";

const project = { baseBranch: "main" } as ThreadPullsView["project"];
const view = (over: Partial<ThreadPullsView>): ThreadPullsView => ({
  project,
  branch: "ta/fix",
  active: null,
  earlier: [],
  ahead: 0,
  uncommitted: 0,
  ...over,
});
const pull = (checks: string[], mergeable = "mergeable", draft = false) =>
  ({
    number: 7,
    url: "https://github.com/acme/web/pull/7",
    title: "Fix login",
    state: "open",
    draft,
    snapshot: { mergeable, checks: checks.map((state, i) => ({ name: `c${i}`, state })) },
  }) as unknown as PullView;

describe("where a thread's branch stands", () => {
  it("has nothing to publish until the agent changes something", () => {
    expect(pullStage(view({}))).toEqual({ kind: "nothing" });
    expect(pullStage(view({ project: null }))).toEqual({ kind: "none" });
  });

  it("offers Create PR, committing first what the agent left uncommitted", () => {
    expect(pullStage(view({ uncommitted: 2 }))).toEqual({
      kind: "create",
      commits: 0,
      uncommitted: 2,
    });
    expect(pullStage(view({ ahead: 3, uncommitted: 0 }))).toEqual({
      kind: "create",
      commits: 3,
      uncommitted: 0,
    });
  });

  it("follows an open PR: new edits to push, and whether it can merge", () => {
    expect(pullStage(view({ active: pull(["success"]), ahead: 1, uncommitted: 1 }))).toEqual({
      kind: "open",
      number: 7,
      uncommitted: 1,
      ready: true,
    });
    expect(pullStage(view({ active: pull(["success", "pending"]), ahead: 1 }))).toMatchObject({
      ready: false,
    });
    expect(pullStage(view({ active: pull(["success"], "conflicting"), ahead: 1 }))).toMatchObject({
      ready: false,
    });
    expect(
      pullStage(view({ active: pull(["success"], "mergeable", true), ahead: 1 })),
    ).toMatchObject({ ready: false });
  });

  it("is merged once its PR merged and nothing new is on the branch", () => {
    const merged = { number: 7, url: "u", title: "Fix login", state: "merged" as const };
    expect(pullStage(view({ earlier: [merged] }))).toEqual({
      kind: "merged",
      number: 7,
      url: "u",
      title: "Fix login",
    });
    expect(pullStage(view({ earlier: [merged], ahead: 1 }))).toMatchObject({
      kind: "create",
      commits: 1,
    });
  });
});

describe("next steps after a finished turn", () => {
  const ids = (stage: Parameters<typeof nextSteps>[0]) => nextSteps(stage).map((step) => step.id);

  it("leads with the step that moves the work on, and always offers Archive", () => {
    expect(ids({ kind: "create", commits: 0, uncommitted: 2 })).toEqual([
      "create-pr",
      "review",
      "archive",
    ]);
    expect(nextSteps({ kind: "create", commits: 0, uncommitted: 2 })[0]).toMatchObject({
      label: "Commit and create PR",
      primary: true,
    });
    expect(ids({ kind: "open", number: 7, uncommitted: 1, ready: false })).toEqual([
      "push",
      "open-pr",
      "archive",
    ]);
    expect(ids({ kind: "open", number: 7, uncommitted: 0, ready: true })).toEqual([
      "merge",
      "open-pr",
      "archive",
    ]);
    expect(ids({ kind: "merged", number: 7, url: "u", title: "t" })).toEqual(["archive"]);
    expect(nextSteps({ kind: "merged", number: 7, url: "u", title: "t" })[0]).toMatchObject({
      primary: true,
    });
    expect(ids({ kind: "nothing" })).toEqual(["archive"]);
    expect(ids({ kind: "none" })).toEqual([]);
  });
});
