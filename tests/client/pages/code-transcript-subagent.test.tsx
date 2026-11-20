import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { TranscriptRow } from "@/pages/code/Transcript";
import type { ToolItem } from "@/lib/code/api";

const prompt =
  "You are working in an isolated git worktree of the monorepo. Profile pytest startup and collection, then report the slowest imports.";

const subagent = (over: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  id: "t1",
  tool: "subagent",
  name: "Task",
  input: { description: "Profile pytest startup", prompt },
  summary: "Profile pytest startup",
  status: "done",
  output: "Collection takes 4.2s. The slowest import is `sqlalchemy`.",
  images: [],
  ...over,
});

const row = (call: ToolItem) => (
  <TranscriptRow
    item={call}
    ctx={{ instanceId: "claude-code", rows: [] }}
    actions={{ recovery: [], recover: () => {}, respond: async () => {} }}
    isLastNotice={false}
  />
);

describe("a subagent row", () => {
  it("opens to show the subagent's result and its full prompt", async () => {
    render(row(subagent()));
    expect(screen.queryByText(/slowest import is/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Profile pytest startup/ }));
    expect(screen.getByText(/slowest import is/)).toBeInTheDocument();
    expect(screen.getByText(/report the slowest imports\./)).toBeInTheDocument();
  });

  it("says when a subagent failed", () => {
    render(row(subagent({ status: "error", output: "Agent crashed" })));
    expect(screen.getByLabelText("Failed")).toBeInTheDocument();
  });
});
