/**
 * The Changes and Review panels while an agent works. A re-read keeps the
 * file list on screen (no spinner, no reset of what was folded), the open
 * file's diff follows its content, and a file that cannot be shown as text
 * says so instead of drawing a whole-file change or freezing the tab.
 */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ConfirmProvider } from "@groot/ui/primitives";
import { ChangesPanel } from "@/pages/code/ChangesPanel";
import { ReviewPanel } from "@/pages/code/ReviewPanel";
import { FileDiff } from "@/pages/code/UnifiedDiff";

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
        const key = query?.path ? `${path}?${query.path}` : path;
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
      <ChangesPanel instanceId="claude-code" cwd="/r" refreshKey={refreshKey} onClose={() => {}} />
    );
    const { rerender } = render(panel("1"));
    await wait(0);
    const header = () => screen.getByTitle("src/a.ts");
    fireEvent.click(header());
    expect(header()).toHaveAttribute("aria-expanded", "false");

    // The agent writes again: the next list read is held back.
    let release: () => void = () => {};
    files = [file("src/a.ts", 3), file("src/b.ts", 1)];
    routes[`${harness}/diffs/working/files`] = () =>
      new Promise((resolve) => (release = () => resolve(files)));
    rerender(panel("2"));
    await wait(1500);
    expect(screen.getByRole("list", { name: "Changed files" })).toBeInTheDocument();
    expect(screen.getAllByTestId("code-file")).toHaveLength(2);

    release();
    await wait(0);
    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(within(header()).getByText("+3")).toBeInTheDocument();
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
        onClose={() => {}}
      />,
    );
    await wait(0);
    fireEvent.click(screen.getByRole("button", { name: "Comment on line 2" }));
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
      <ChangesPanel instanceId="claude-code" cwd="/r" refreshKey={refreshKey} onClose={() => {}} />
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
        <ReviewPanel
          threadId="claude-code:t1"
          baseBranch="main"
          refreshKey={refreshKey}
          onClose={() => {}}
        />
      </ConfirmProvider>
    );
    const { rerender } = render(panel("1"));
    await wait(0);
    expect(screen.getByText("one")).toBeInTheDocument();

    hash = "h2";
    content = "one\ntwo\n";
    rerender(panel("2"));
    await wait(750);
    expect(screen.getByText("two")).toBeInTheDocument();
  });
});

describe("a file that cannot be shown as text", () => {
  it("says it is binary or too large instead of drawing a change", () => {
    render(<FileDiff path="logo.png" oldContent="" newContent="" unshowable="binary" />);
    expect(screen.getByText(/Binary file/)).toBeInTheDocument();
  });

  it("draws the first part of a very long diff and says how much it left out", () => {
    const newContent = Array.from({ length: 12_000 }, (_, i) => `line ${i}`).join("\n");
    const { container } = render(<FileDiff path="big.ts" oldContent="" newContent={newContent} />);
    expect(container.querySelectorAll("[data-kind=add]").length).toBeLessThanOrEqual(5_000);
    expect(screen.getByText(/more lines not shown/)).toBeInTheDocument();
  });
});
