import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { NextSteps } from "@/pages/code/NextSteps";
import type { ThreadPullsView } from "../../../apps/web/src/shared/api/code";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const project = {
  id: "p1",
  name: "web",
  baseBranch: "main",
  settings: {},
} as unknown as ThreadPullsView["project"];

function show(next: Partial<ThreadPullsView>) {
  const view: ThreadPullsView = {
    project,
    branch: "ta/fix",
    active: null,
    earlier: [],
    ahead: 0,
    uncommitted: 0,
    landed: null,
    ...next,
  };
  fakeApi().get("/code/threads/t1/pr", () => view);
  const onStep = vi.fn();
  render(
    <AppQueryProvider>
      <NextSteps threadId="t1" refreshKey="k" onStep={onStep} />
    </AppQueryProvider>,
  );
  return onStep;
}

describe("next steps after a finished turn", () => {
  it("leads with Commit and create PR when the agent left changes, and runs it", async () => {
    const onStep = show({ uncommitted: 2 });
    const create = await screen.findByRole("button", { name: /Commit and create PR/ });
    expect(screen.getAllByRole("button").map((b) => b.textContent?.replace(/⇧?[PM]$/, ""))).toEqual(
      ["Commit and create PR", "Review changes", "Archive"],
    );
    act(() => create.click());
    expect(onStep).toHaveBeenCalledWith("create-pr");
  });

  it("offers only Archive once the PR merged", async () => {
    const onStep = show({ earlier: [{ number: 9, url: "u", title: "Fix", state: "merged" }] });
    const archive = await screen.findByRole("button", { name: "Archive" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    act(() => archive.click());
    expect(onStep).toHaveBeenCalledWith("archive");
  });
});
