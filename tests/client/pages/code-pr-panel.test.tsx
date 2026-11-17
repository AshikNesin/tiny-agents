/**
 * The PR tab re-reads its pull request while it is on screen. Each read is a
 * fresh reconcile with GitHub, so a project on `gh` or a token (no
 * webhooks) shows a finished check within seconds instead of waiting for
 * the server's 1 to 5 minute poll. A hidden tab stops reading, and a failed
 * background read keeps what is shown.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PullPanel } from "@/pages/code/PullPanel";
import type { ThreadPullsView } from "../../../apps/web/src/shared/api/code";

type CheckState = NonNullable<
  NonNullable<ThreadPullsView["active"]>["snapshot"]
>["checks"][number]["state"];

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

/** What GitHub says the check is, read by each GET of the PR tab. */
let checkState: CheckState = "pending";
let failReads = false;
let reads = 0;
/** The PR's description on GitHub, and the edits the tab sent. */
let body = "";
const edits: unknown[] = [];

// The network: the PR tab's one read.
vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string) => {
        if (path !== "/code/threads/shelley%3At1/pr") throw new Error(`unexpected ${path}`);
        reads += 1;
        if (failReads) throw new Error("GitHub is down");
        return view(checkState);
      },
      patch: async (path: string, change: { body?: string }) => {
        if (path !== "/code/threads/shelley%3At1/pr") throw new Error(`unexpected ${path}`);
        edits.push(change);
        if (change.body !== undefined) body = change.body;
        return view(checkState);
      },
    }),
  };
});

const project: NonNullable<ThreadPullsView["project"]> = {
  id: "p1",
  name: "r",
  repo: { owner: "o", name: "r" },
  transport: "gh",
  baseBranch: "main",
  checkoutPath: "/home/exedev/tiny-agents-code/o--r/checkout",
  defaultInstanceId: null,
  defaultModel: null,
  settings: {
    scripts: {},
    archiveOnMerge: true,
    protectedPaths: [],
    autofix: {
      triggers: { checks: true, reviews: true, conflicts: true, mergeQueue: true },
      finalCheck: false,
      autoMergeByDefault: false,
      trustedBots: [],
      hourlyLimit: 6,
      noOwnerLimit: 10,
      passMinutes: 20,
      onByDefault: false,
    },
  },
  createdAt: "2026-11-01T10:00:00Z",
};

function view(state: CheckState): ThreadPullsView {
  return {
    project,
    branch: "ta/fix-1a2b",
    ahead: 1,
    spend: { usd: null, limitUsd: null },
    earlier: [],
    active: {
      id: "pr1",
      number: 12,
      url: "https://github.com/o/r/pull/12",
      title: "Fix the login",
      state: "open",
      draft: false,
      headRef: "ta/fix-1a2b",
      baseRef: "main",
      syncedAt: null,
      autofix: false,
      autoMerge: false,
      loop: { status: "off", reason: null },
      stalled: [],
      ignored: [],
      passes: [],
      snapshot: {
        id: "n1",
        number: 12,
        url: "https://github.com/o/r/pull/12",
        title: "Fix the login",
        body,
        state: "open",
        draft: false,
        headRef: "ta/fix-1a2b",
        headSha: "abc",
        baseRef: "main",
        fromFork: false,
        mergeable: "mergeable",
        mergeMethods: ["squash"],
        autoMerge: false,
        inMergeQueue: false,
        queueRemovals: [],
        author: "AshikNesin",
        checks: [
          {
            name: "Tests",
            state,
            startedAt: null,
            completedAt: null,
            url: null,
            jobId: null,
          },
        ],
        reviews: [],
        threads: [],
        comments: [],
      },
    },
  };
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  checkState = "pending";
  failReads = false;
  reads = 0;
  body = "";
  edits.length = 0;
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const panel = () =>
  render(<PullPanel threadId="shelley:t1" refreshKey="k" onAttach={() => {}} onClose={() => {}} />);

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("Code PR tab", () => {
  it("leads with one status line and a checks bar", async () => {
    checkState = "success";
    panel();
    await wait(0);
    expect(screen.getByLabelText("Status")).toHaveTextContent("open · ta/fix-1a2b → main");
    const bar = screen.getByRole("img", { name: "1 passed, 0 failed, 0 pending" });
    expect(bar).toBeInTheDocument();
  });

  it("re-reads the pull request every 15 seconds while it is on screen", async () => {
    panel();
    await wait(0);
    expect(screen.getByText("Checks 0 of 1")).toBeInTheDocument();

    checkState = "success";
    await wait(15_000);
    expect(screen.getByText("Checks 1 of 1")).toBeInTheDocument();
  });

  it("stops reading while the page is hidden, and reads again on return", async () => {
    panel();
    await wait(0);
    const first = reads;

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    checkState = "success";
    await wait(60_000);
    expect(reads).toBe(first);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await wait(0);
    expect(screen.getByText("Checks 1 of 1")).toBeInTheDocument();
  });

  it("keeps what it shows when a background read fails, and the next read catches up", async () => {
    panel();
    await wait(0);
    failReads = true;
    await wait(15_000);
    expect(screen.getByText("Checks 0 of 1")).toBeInTheDocument();
    expect(screen.queryByText(/GitHub is down/)).toBeNull();

    failReads = false;
    checkState = "success";
    await wait(15_000);
    expect(screen.getByText("Checks 1 of 1")).toBeInTheDocument();
  });
});

describe("the pull request's description", () => {
  it("reads as markdown, without the template's hidden comments", async () => {
    body =
      "<!-- This is a feature PR template -->\n\n## Feature Description\n\nSpeeds up **the API tests**.\n\n- `pytest-xdist` as a dev dependency";
    render(
      <PullPanel threadId="shelley:t1" refreshKey="1" onAttach={() => {}} onClose={() => {}} />,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("heading", { name: "Feature Description" })).toBeInTheDocument();
    expect(screen.getByText("the API tests")).toHaveAttribute("data-streamdown", "strong");
    expect(screen.getByText("pytest-xdist").tagName).toBe("CODE");
    expect(screen.queryByText(/<!--|## Feature/)).toBeNull();
  });

  it("edits the description and saves it to GitHub", async () => {
    body = "Old words";
    render(
      <PullPanel threadId="shelley:t1" refreshKey="1" onAttach={() => {}} onClose={() => {}} />,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => screen.getByRole("button", { name: "Edit description" }).click());
    const box = screen.getByRole("textbox", { name: "Description" });
    expect(box).toHaveValue("Old words");
    fireEvent.change(box, { target: { value: "## New\n\nBetter **words**" } });
    act(() => screen.getByRole("button", { name: "Save description" }).click());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(edits).toEqual([{ body: "## New\n\nBetter **words**" }]);
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(screen.getByRole("heading", { name: "New" })).toBeInTheDocument();
  });
});
