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

  it("dragging down the line numbers selects that range and opens one composer for it", async () => {
    const user = userEvent.setup();
    const onComment = vi.fn(async () => {});
    render(
      <FileDiff path="a.txt" oldContent="" newContent={"a\nb\nc\nd\n"} onComment={onComment} />,
    );
    const gutter = (no: number) => screen.getByRole("button", { name: `Comment on line ${no}` });
    fireEvent.pointerDown(gutter(2), { button: 0, pointerId: 1 });
    fireEvent.pointerEnter(gutter(3), { pointerId: 1 });
    fireEvent.pointerEnter(gutter(4), { pointerId: 1 });
    // No composer jumps around while the range is still being dragged.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.pointerUp(window, { pointerId: 1 });

    await user.type(
      screen.getByRole("textbox", { name: "Comment on a.txt lines 2–4" }),
      "Merge these",
    );
    await user.click(screen.getByRole("button", { name: "Comment" }));
    expect(onComment).toHaveBeenCalledWith({ from: 2, to: 4, side: "new" }, "Merge these");
  });

  it("dragging up from a line selects from where the drag ended to where it began", () => {
    render(
      <FileDiff
        path="a.txt"
        oldContent=""
        newContent={"a\nb\nc\nd\n"}
        onComment={async () => {}}
      />,
    );
    const gutter = (no: number) => screen.getByRole("button", { name: `Comment on line ${no}` });
    fireEvent.pointerDown(gutter(4), { button: 0, pointerId: 1 });
    fireEvent.pointerEnter(gutter(1), { pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(screen.getByText("Commenting on lines 1–4")).toBeInTheDocument();
  });

  it("keeps what you typed when the range is widened", async () => {
    const user = userEvent.setup();
    render(
      <FileDiff
        path="a.txt"
        oldContent=""
        newContent={"a\nb\nc\nd\n"}
        onComment={async () => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Comment on line 1" }));
    await user.type(screen.getByRole("textbox"), "Half a thought");
    fireEvent.click(screen.getByRole("button", { name: "Comment on line 3" }), { shiftKey: true });
    expect(screen.getByRole("textbox", { name: "Comment on a.txt lines 1–3" })).toHaveValue(
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
