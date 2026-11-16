/**
 * The Code page's diff, as a reviewer uses it: a line's gutter offers
 * Comment, which opens a composer right under that line; a saved comment
 * stays under its lines until it is sent; and long unchanged runs fold into
 * "Show N more lines" so the change itself is what you read.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { FileDiff } from "@/pages/code/UnifiedDiff";

const numbered = (count: number, change?: { at: number; text: string }) =>
  Array.from({ length: count }, (_, i) =>
    change && i + 1 === change.at ? change.text : `line ${i + 1}`,
  ).join("\n") + "\n";

describe("commenting on a line", () => {
  it("opens a composer under the line and saves what you write for that line", async () => {
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

    await user.click(screen.getByRole("button", { name: "Comment on line 2" }));
    const box = screen.getByRole("textbox", { name: "Comment on src/a.ts line 2" });
    // The composer sits under the commented line, before the next one.
    const rows = [...document.querySelectorAll("[data-kind], [data-composer]")];
    const composerAt = rows.findIndex((el) => el.hasAttribute("data-composer"));
    expect(rows[composerAt - 1]).toHaveTextContent("TWO");
    expect(rows[composerAt + 1]).toHaveTextContent("three");

    await user.type(box, "Keep this lowercase");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    expect(onComment).toHaveBeenCalledWith({ from: 2, to: 2, side: "new" }, "Keep this lowercase");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Comment on removed line 2" }));
    await user.type(screen.getByRole("textbox"), "Why remove it?{Meta>}{Enter}{/Meta}");
    expect(onComment).toHaveBeenCalledWith({ from: 2, to: 2, side: "old" }, "Why remove it?");
  });

  it("shift-click on another line widens the range being commented on", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn(async () => {});
    render(
      <FileDiff path="a.txt" oldContent="" newContent={"a\nb\nc\nd\n"} onComment={onComment} />,
    );
    await user.click(screen.getByRole("button", { name: "Comment on line 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Comment on line 3" }), { shiftKey: true });
    expect(screen.getByText("Commenting on lines 1–3")).toBeInTheDocument();
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
    const saved = screen.getByRole("note", { name: "Comment on line 2" });
    expect(saved).toHaveTextContent("Lowercase, please");
    await user.click(within(saved).getByRole("button", { name: "Remove comment" }));
    expect(onRemove).toHaveBeenCalledWith("d1");
  });
});

describe("unchanged lines", () => {
  it("folds long unchanged runs and shows them on request", async () => {
    const user = userEvent.setup();
    render(
      <FileDiff
        path="long.txt"
        oldContent={numbered(100)}
        newContent={numbered(100, { at: 50, text: "changed" })}
      />,
    );
    // Three lines of context either side of line 50 are shown; the rest fold.
    expect(screen.getByText("line 47")).toBeInTheDocument();
    expect(screen.getByText("line 53")).toBeInTheDocument();
    expect(screen.queryByText("line 10")).not.toBeInTheDocument();
    expect(screen.queryByText("line 90")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show 46 more lines" }));
    expect(screen.getByText("line 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 47 more lines" }));
    expect(screen.getByText("line 90")).toBeInTheDocument();
  });
});
