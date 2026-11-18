/**
 * The Code page's diff, as a reviewer uses it: click a line number to open a
 * composer for that line, drag or shift-click to take a range, and saved
 * comments stay under their lines until they are sent. The diff is drawn by
 * @pierre/diffs (diffs.com); the composer and saved comments are ours.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { FileDiff, PatchView } from "@/pages/code/UnifiedDiff";
import { clickLine, diffRoot, diffText, drag, line, lineNumber } from "../diff-dom";

const numbered = (count: number, change?: { at: number; text: string }) =>
  Array.from({ length: count }, (_, i) =>
    change && i + 1 === change.at ? change.text : `line ${i + 1}`,
  ).join("\n") + "\n";

describe("commenting on lines", () => {
  it("clicking a line number opens a composer and saves what you write for that line", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn(async () => {});
    render(
      <FileDiff
        path="src/a.ts"
        oldContent={"one\ntwo\nthree\n"}
        newContent={"one\nTWO\nthree\n"}
        onComment={onComment}
      />,
    );
    await clickLine(line(await diffRoot(), 2));

    const box = await screen.findByRole("textbox", { name: "Comment on src/a.ts line 2" });
    await user.type(box, "Keep this lowercase");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    expect(onComment).toHaveBeenCalledWith(
      { from: 2, to: 2, side: "new" },
      "Keep this lowercase",
      "agent",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("the composer takes the keyboard as it opens, so you can type straight away", async () => {
    render(
      <FileDiff
        path="src/a.ts"
        oldContent={"one\ntwo\nthree\n"}
        newContent={"one\nTWO\nthree\n"}
        onComment={vi.fn(async () => {})}
      />,
    );
    await clickLine(line(await diffRoot(), 2));

    const box = await screen.findByRole("textbox", { name: "Comment on src/a.ts line 2" });
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("comments on a removed line by its old line number", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn(async () => {});
    render(
      <FileDiff
        path="a.txt"
        oldContent={"keep\ngone\nkeep too\n"}
        newContent={"keep\nkeep too\n"}
        onComment={onComment}
      />,
    );
    await clickLine(line(await diffRoot(), 2, "old"));
    await user.type(await screen.findByRole("textbox"), "Why remove it?{Meta>}{Enter}{/Meta}");
    expect(onComment).toHaveBeenCalledWith(
      { from: 2, to: 2, side: "old" },
      "Why remove it?",
      "agent",
    );
  });

  it("dragging down the line numbers takes that range, with one composer for it", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn(async () => {});
    render(
      <FileDiff path="a.txt" oldContent="" newContent={"a\nb\nc\nd\n"} onComment={onComment} />,
    );
    const root = await diffRoot();
    await drag([line(root, 2), line(root, 3), line(root, 4)]);

    const box = await screen.findByRole("textbox", { name: "Comment on a.txt lines 2–4" });
    await user.type(box, "Merge these");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    expect(onComment).toHaveBeenCalledWith({ from: 2, to: 4, side: "new" }, "Merge these", "agent");
  });

  it("dragging up takes the range from where it ended to where it began", async () => {
    render(
      <FileDiff
        path="a.txt"
        oldContent=""
        newContent={"a\nb\nc\nd\n"}
        onComment={async () => {}}
      />,
    );
    const root = await diffRoot();
    await drag([line(root, 4), line(root, 1)]);
    expect(await screen.findByText("Commenting on lines 1–4")).toBeInTheDocument();
  });

  it("a range from removed lines into added ones is commented on by its new lines", async () => {
    render(
      <FileDiff
        path="a.txt"
        oldContent={"keep\nold one\nold two\nkeep too\n"}
        newContent={"keep\nnew one\nnew two\nkeep too\n"}
        onComment={async () => {}}
      />,
    );
    const root = await diffRoot();
    await drag([line(root, 2, "old"), line(root, 3, "new")]);
    expect(await screen.findByText("Commenting on lines 2–3")).toBeInTheDocument();
  });

  it("shift-click widens the range and keeps what you typed", async () => {
    const user = userEvent.setup();
    render(
      <FileDiff
        path="a.txt"
        oldContent=""
        newContent={"a\nb\nc\nd\n"}
        onComment={async () => {}}
      />,
    );
    const root = await diffRoot();
    await clickLine(line(root, 1));
    await user.type(await screen.findByRole("textbox"), "Half a thought");
    await clickLine(line(root, 3), { shiftKey: true });
    expect(await screen.findByRole("textbox", { name: "Comment on a.txt lines 1–3" })).toHaveValue(
      "Half a thought",
    );
  });

  it("keeps a saved comment under its lines, and removes it on request", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <FileDiff
        path="a.txt"
        oldContent={"one\ntwo\nthree\n"}
        newContent={"one\nTWO\nthree\n"}
        onComment={async () => {}}
        comments={[{ id: "d1", side: "new", startLine: 2, endLine: 2, body: "Lowercase, please" }]}
        onRemoveComment={onRemove}
      />,
    );
    const saved = await screen.findByRole("note", { name: "Comment on line 2" });
    expect(saved).toHaveTextContent("Lowercase, please");
    // Slotted under its line: the slot names the line it follows.
    expect(saved.closest("[slot]")?.getAttribute("slot")).toMatch(/additions-2/);
    await user.click(within(saved).getByRole("button", { name: "Remove comment" }));
    expect(onRemove).toHaveBeenCalledWith("d1");
  });
});

describe("commenting in a PR review", () => {
  it("Comment adds to the GitHub review, Ask assistant goes to the assistant", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn(async () => {});
    render(
      <FileDiff
        path="src/a.ts"
        oldContent={"one\ntwo\n"}
        newContent={"one\nTWO\n"}
        onComment={onComment}
        reviewing
      />,
    );
    const root = await diffRoot();
    await clickLine(line(root, 2));
    const box = await screen.findByRole("textbox", { name: "Comment on src/a.ts line 2" });
    expect(box).toHaveAttribute("placeholder", "Leave a review comment…");
    await user.type(box, "Why caps?{Meta>}{Enter}{/Meta}");
    expect(onComment).toHaveBeenLastCalledWith(
      { from: 2, to: 2, side: "new" },
      "Why caps?",
      "github",
    );

    await clickLine(line(root, 2));
    await user.type(await screen.findByRole("textbox"), "Is this used elsewhere?");
    await user.click(screen.getByRole("button", { name: "Ask assistant" }));
    expect(onComment).toHaveBeenLastCalledWith(
      { from: 2, to: 2, side: "new" },
      "Is this used elsewhere?",
      "agent",
    );
  });

  it("Suggest change starts a suggestion block with the selected lines", async () => {
    const user = userEvent.setup();
    render(
      <FileDiff
        path="a.txt"
        oldContent=""
        newContent={"a\nb\nc\nd\n"}
        onComment={async () => {}}
        reviewing
      />,
    );
    const root = await diffRoot();
    await drag([line(root, 2), line(root, 3)]);
    const box = await screen.findByRole("textbox", { name: "Comment on a.txt lines 2–3" });
    await user.type(box, "Join these");
    await user.click(screen.getByRole("button", { name: "Suggest change" }));
    expect(box).toHaveValue("Join these\n\n```suggestion\nb\nc\n```");
  });

  it("offers no suggestion on removed lines, which GitHub cannot change", async () => {
    render(
      <FileDiff
        path="a.txt"
        oldContent={"keep\ngone\n"}
        newContent={"keep\n"}
        onComment={async () => {}}
        reviewing
      />,
    );
    await clickLine(line(await diffRoot(), 2, "old"));
    await screen.findByRole("textbox");
    expect(screen.queryByRole("button", { name: "Suggest change" })).not.toBeInTheDocument();
  });

  it("shows where each saved comment goes", async () => {
    render(
      <FileDiff
        path="a.txt"
        oldContent={"one\ntwo\n"}
        newContent={"one\nTWO\n"}
        onComment={async () => {}}
        reviewing
        comments={[
          { id: "g1", side: "new", startLine: 2, endLine: 2, body: "Lowercase", tag: "Pending" },
        ]}
      />,
    );
    expect(await screen.findByRole("note", { name: "Comment on line 2" })).toHaveTextContent(
      "LowercasePending",
    );
  });
});

describe("unchanged lines", () => {
  it("folds long unchanged runs around a change", async () => {
    render(
      <FileDiff
        path="long.txt"
        oldContent={numbered(100)}
        newContent={numbered(100, { at: 50, text: "changed" })}
      />,
    );
    const text = diffText(await diffRoot());
    expect(text).toContain("line 47");
    expect(text).toContain("changed");
    expect(text).toContain("line 53");
    expect(text).not.toContain("line 10");
    expect(text).not.toContain("line 90");
  });
});

describe("a patch from the agent", () => {
  it("draws a patch that starts at its first hunk, numbered from the hunk", async () => {
    render(
      <PatchView
        path="src/app.ts"
        patch={"@@ -10,3 +10,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n"}
      />,
    );
    const root = await diffRoot();
    expect(diffText(root)).toEqual([
      "const a = 1;",
      "const b = 2;",
      "const b = 3;",
      "const c = 4;",
    ]);
    expect(lineNumber(root, 11, "old").textContent).toBe("11");
    expect(lineNumber(root, 11, "new").textContent).toBe("11");
  });
});
