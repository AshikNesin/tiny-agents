/**
 * The Changes and Review panels while an agent works. A re-read keeps the
 * file list on screen (no spinner, no reset of what was folded), the open
 * file's diff follows its content, and a file that cannot be shown as text
 * says so instead of drawing a whole-file change or freezing the tab.
 */
import React from "react";
import { act, fireEvent, render as renderBare, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConfirmProvider } from "@groot/ui/primitives";
import { ChangesPanel } from "@/pages/code/ChangesPanel";
import { PullDiffs } from "@/pages/code/PullDiffs";
import { ReviewPanel } from "@/pages/code/ReviewPanel";
import type { PullReviewView } from "../../../apps/web/src/shared/api/code";
import { FileDiff } from "@/pages/code/UnifiedDiff";
import { clickLine, diffText, line } from "../diff-dom";
import type { DiffView } from "@/pages/code/DiffWorkspace";
import { notifyManager } from "@tanstack/react-query";
import { AppQueryProvider } from "../query-provider";

// React Query hands answers to the page on a zero timeout, which fake timers
// push a millisecond on when it is set mid-tick; as microtasks, a tick of 0
// lands an answer as a plain promise does.
notifyManager.setScheduler(queueMicrotask);

/** Each render gets its own React Query cache, as the app gives the page one. */
const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

/** Unified diffs, nothing folded, the file drawer shut. */
const STILL_VIEW: DiffView = {
  style: "unified",
  setStyle: () => undefined,
  wide: false,
  collapse: null,
  setCollapse: () => undefined,
  drawer: { open: false, onOpenChange: () => undefined },
};

/** The drawn diff's shadow root (the renderer draws it there). */
const drawn = () => document.querySelector("diffs-container")?.shadowRoot ?? null;
/** The drawn diff's lines as text; none until a diff is drawn. */
const shown = () => {
  const root = drawn();
  return root ? diffText(root) : [];
};

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

/** The network: each GET path answers from this table (a function may hold the answer back). */
let routes: Record<string, () => unknown> = {};

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string, query?: Record<string, string>) => {
        const key =
          (query?.path ? `${path}?${query.path}` : path) +
          (query?.scope ? `#scope=${query.scope}` : "");
        const route = routes[key];
        if (!route) throw new Error(`unexpected ${key}`);
        return route();
      },
    }),
  };
});

const harness = "/code/harnesses/claude-code";
const working = {
  id: "working",
  message: "Uncommitted changes",
  author: "",
  timestamp: "2026-11-01T10:00:00Z",
  filesCount: 2,
  additions: 2,
  deletions: 0,
};
const file = (path: string, additions: number) => ({
  path,
  status: "modified" as const,
  additions,
  deletions: 0,
  isGenerated: false,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  routes = {};
  vi.restoreAllMocks();
});

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("Changes panel", () => {
  it("keeps the list and what you folded on screen while it re-reads", async () => {
    let files = [file("src/a.ts", 1), file("src/b.ts", 1)];
    routes[`${harness}/diffs`] = () => ({ diffs: [working], gitRoot: "/r" });
    routes[`${harness}/diffs/working/files`] = () => files;
    routes[`${harness}/diffs/working/file?src/a.ts`] = () => ({
      path: "src/a.ts",
      oldContent: "",
      newContent: "a\n",
    });
    routes[`${harness}/diffs/working/file?src/b.ts`] = () => ({
      path: "src/b.ts",
      oldContent: "",
      newContent: "b\n",
    });
    const panel = (refreshKey: string) => (
      <ChangesPanel instanceId="claude-code" cwd="/r" refreshKey={refreshKey} />
    );
    const { rerender } = render(panel("1"));
    await wait(0);
    fireEvent.click(screen.getByRole("button", { name: "Fold src/a.ts" }));
    expect(screen.getByRole("button", { name: "Unfold src/a.ts" })).toBeInTheDocument();

    // The agent writes again: the next list read is held back.
    let release: () => void = () => {};
    files = [file("src/a.ts", 3), file("src/b.ts", 1)];
    routes[`${harness}/diffs/working/files`] = () =>
      new Promise((resolve) => (release = () => resolve(files)));
    rerender(panel("2"));
    await wait(1500);
    expect(screen.getAllByTestId("code-file")).toHaveLength(2);

    release();
    await wait(0);
    expect(screen.getByRole("button", { name: "Unfold src/a.ts" })).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });
});

describe("commenting on a change", () => {
  it("saves a line comment for the thread, with the lines it is about", async () => {
    routes[`${harness}/diffs`] = () => ({ diffs: [working], gitRoot: "/r" });
    routes[`${harness}/diffs/working/files`] = () => [file("src/a.ts", 1)];
    routes[`${harness}/diffs/working/file?src/a.ts`] = () => ({
      path: "src/a.ts",
      oldContent: "one\ntwo\n",
      newContent: "one\nTWO\n",
    });
    const add = vi.fn(async () => {});
    render(
      <ChangesPanel
        instanceId="claude-code"
        cwd="/r"
        refreshKey="1"
        commenting={{ comments: [], add, remove: () => {} }}
      />,
    );
    await wait(0);
    await clickLine(line(drawn()!, 2));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment on src/a.ts line 2" }), {
      target: { value: "Keep it lowercase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await wait(0);
    expect(add).toHaveBeenCalledWith({
      path: "src/a.ts",
      side: "new",
      startLine: 2,
      endLine: 2,
      quote: "TWO",
      body: "Keep it lowercase",
    });
  });
});

describe("re-reading while the agent writes non-stop", () => {
  it("keeps re-reading at a steady pace instead of waiting for a pause", async () => {
    let reads = 0;
    routes[`${harness}/diffs`] = () => ({ diffs: [working], gitRoot: "/r" });
    routes[`${harness}/diffs/working/files`] = () => {
      reads += 1;
      return [file("src/a.ts", reads)];
    };
    routes[`${harness}/diffs/working/file?src/a.ts`] = () => ({
      path: "src/a.ts",
      oldContent: "",
      newContent: "a\n",
    });
    const panel = (refreshKey: string) => (
      <ChangesPanel instanceId="claude-code" cwd="/r" refreshKey={refreshKey} />
    );
    const { rerender } = render(panel("0"));
    await wait(0);
    const first = reads;
    // A new key every 300 ms for 3 s: the agent never pauses.
    for (let i = 1; i <= 10; i++) {
      rerender(panel(String(i)));
      await wait(300);
    }
    expect(reads - first).toBeGreaterThanOrEqual(3);
  });
});

describe("Review panel", () => {
  it("shows every changed file in one column, with the tree a drawer under Files", async () => {
    const thread = "/code/threads/claude-code%3At1";
    routes[`${thread}/checkpoints`] = () => [];
    routes[`${thread}/review/drafts`] = () => [];
    routes[`${thread}/pr`] = () => ({ branch: "ta/fix-login", ahead: 2 });
    routes[`${thread}/review/files`] = () => [
      { ...file("src/auth/login.ts", 4), hash: "h1", viewed: false },
      { ...file("README.md", 1), status: "added", hash: "h2", viewed: false },
    ];
    routes[`${thread}/review/file?src/auth/login.ts`] = () => ({
      path: "src/auth/login.ts",
      oldContent: "",
      newContent: "export const login = 1;\n",
    });
    routes[`${thread}/review/file?README.md`] = () => ({
      path: "README.md",
      oldContent: "",
      newContent: "# Read me\n",
    });
    render(
      <ConfirmProvider>
        <ReviewPanel threadId="claude-code:t1" baseBranch="main" refreshKey="1" />
      </ConfirmProvider>,
    );
    await wait(0);
    expect(screen.getByText("ta/fix-login")).toBeInTheDocument();
    expect(screen.getByText("2 ahead")).toBeInTheDocument();
    // Both files in the column at once, folders first, no file to pick.
    expect(screen.getAllByTestId("code-file").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Fold src/auth/login.ts",
      "Fold README.md",
    ]);
    await wait(0);
    expect(shown()).toContain("export const login = 1;");
    expect(screen.getByText("0/2 viewed")).toBeInTheDocument();

    // The tree waits in a drawer.
    expect(screen.queryByRole("navigation", { name: "Changed files" })).toBeNull();
    act(() => screen.getByRole("button", { name: "Files" }).click());
    expect(screen.getByRole("navigation", { name: "Changed files" })).toBeInTheDocument();
    act(() => screen.getAllByRole("button", { name: "Close files" })[0]!.click());
    expect(screen.queryByRole("navigation", { name: "Changed files" })).toBeNull();
  });

  it("on the Review page, keeps the tree beside the column and folds a file marked viewed", async () => {
    const thread = "/code/threads/claude-code%3At1";
    routes[`${thread}/checkpoints`] = () => [];
    routes[`${thread}/review/drafts`] = () => [];
    routes[`${thread}/review/files`] = () => [
      { ...file("src/a.ts", 1), hash: "h1", viewed: false },
      { ...file("src/b.ts", 1), hash: "h2", viewed: false },
    ];
    for (const name of ["src/a.ts", "src/b.ts"])
      routes[`${thread}/review/file?${name}`] = () => ({
        path: name,
        oldContent: "",
        newContent: `${name}\n`,
      });
    const setViewed = vi.fn(async () => undefined);
    const { projectsApi } = await import("@/lib/code/projects");
    vi.spyOn(projectsApi, "setViewed").mockImplementation(setViewed);
    render(
      <ConfirmProvider>
        <ReviewPanel threadId="claude-code:t1" baseBranch="main" refreshKey="1" page />
      </ConfirmProvider>,
    );
    await wait(0);
    expect(screen.getByRole("navigation", { name: "Changed files" })).toBeInTheDocument();
    await act(async () => screen.getByRole("checkbox", { name: "Viewed src/b.ts" }).click());
    expect(screen.getByRole("button", { name: "Unfold src/b.ts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diff stats" })).toHaveTextContent("1 of 2");
  });

  it("shows the open file's new content when the agent changes it again", async () => {
    const thread = "/code/threads/claude-code%3At1";
    let hash = "h1";
    let content = "one\n";
    routes[`${thread}/checkpoints`] = () => [];
    routes[`${thread}/review/drafts`] = () => [];
    routes[`${thread}/review/files`] = () => [{ ...file("README.md", 1), hash, viewed: false }];
    routes[`${thread}/review/file?README.md`] = () => ({
      path: "README.md",
      oldContent: "",
      newContent: content,
    });
    const panel = (refreshKey: string) => (
      <ConfirmProvider>
        <ReviewPanel threadId="claude-code:t1" baseBranch="main" refreshKey={refreshKey} page />
      </ConfirmProvider>
    );
    const { rerender } = render(panel("1"));
    await wait(0);
    expect(shown()).toEqual(["one"]);

    hash = "h2";
    content = "one\ntwo\n";
    rerender(panel("2"));
    await wait(750);
    expect(shown()).toEqual(["one", "two"]);
  });
});

describe("a PR review you reviewed before", () => {
  it("opens on the changes since your review", async () => {
    const thread = "/code/threads/review%3Arv1";
    routes[`${thread}/review/drafts`] = () => [];
    routes[`${thread}/review/files#scope=review`] = () => [
      { ...file("src/new.ts", 3), hash: "h1", viewed: false },
    ];
    routes[`${thread}/review/file?src/new.ts#scope=review`] = () => ({
      path: "src/new.ts",
      oldContent: "old\n",
      newContent: "after review\n",
    });
    routes[`${thread}/review/files`] = () => [
      { ...file("src/new.ts", 4), hash: "h1", viewed: false },
      { ...file("src/old.ts", 9), hash: "h2", viewed: true },
    ];
    routes[`${thread}/review/file?src/new.ts`] = () => ({
      path: "src/new.ts",
      oldContent: "",
      newContent: "whole\n",
    });
    render(
      <ConfirmProvider>
        <PullDiffs
          review={
            {
              id: "rv1",
              key: "review:rv1",
              baseRef: "main",
              headSha: "head2",
              reviewedSha: "abc1234def",
            } as PullReviewView
          }
          refreshKey="1"
          view={STILL_VIEW}
        />
      </ConfirmProvider>,
    );
    await wait(0);
    const scope = screen.getByRole("button", { name: "Changes to show" });
    expect(scope).toHaveTextContent("Since your review");
    expect(screen.getByRole("button", { name: "Fold src/new.ts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fold src/old.ts" })).not.toBeInTheDocument();
    await wait(50);
    expect(shown()).toEqual(["old", "after review"]);
  });
});

describe("a file that cannot be shown as text", () => {
  it("says it is binary or too large instead of drawing a change", () => {
    render(<FileDiff path="logo.png" oldContent="" newContent="" unshowable="binary" />);
    expect(screen.getByText(/Binary file/)).toBeInTheDocument();
  });

  it("draws the first part of a very long diff and says how much it left out", async () => {
    const newContent = Array.from({ length: 12_000 }, (_, i) => `line ${i}`).join("\n");
    render(<FileDiff path="big.ts" oldContent="" newContent={newContent} />);
    await wait(0);
    expect(shown().length).toBe(4_000);
    expect(screen.getByText(/more lines not shown/)).toBeInTheDocument();
  });
});
