/**
 * A finished turn's work folds behind one quiet "Worked for" row, the way Amp
 * and Hoplite read: the progress notes and commands are one click away.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { TranscriptRow } from "@/pages/code/Transcript";

describe("a finished turn's work", () => {
  it("shows one 'Worked for' row and opens to the work", async () => {
    render(
      <TranscriptRow
        item={{
          kind: "work",
          id: "work:a",
          durationMs: 214_000,
          costUsd: 0.4,
          items: [{ kind: "assistant", id: "a", text: "Found the root cause in the shell" }],
        }}
        ctx={{ instanceId: "shelley", rows: [] }}
        actions={{ recovery: [], recover: () => {}, respond: async () => {} }}
        isLastNotice={false}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Worked for 3m 34s · $0.40" });
    expect(screen.queryByText("Found the root cause in the shell")).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByText("Found the root cause in the shell")).toBeInTheDocument();
  });

  it("says what the work was when the harness reports no duration", () => {
    render(
      <TranscriptRow
        item={{
          kind: "work",
          id: "work:t",
          items: [
            {
              kind: "tool",
              id: "t",
              tool: "bash",
              name: "bash",
              input: {},
              summary: "git diff --stat",
              status: "done",
              images: [],
            },
          ],
        }}
        ctx={{ instanceId: "shelley", rows: [] }}
        actions={{ recovery: [], recover: () => {}, respond: async () => {} }}
        isLastNotice={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Ran 1 command" })).toBeInTheDocument();
  });
});
