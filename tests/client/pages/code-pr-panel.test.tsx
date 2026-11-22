import React from "react";
import { act, fireEvent, render as renderBare, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PullPanel } from "@/pages/code/PullPanel";
import type { CheckLogView, ThreadPullsView } from "../../../apps/web/src/shared/api/code";
import { notifyManager } from "@tanstack/react-query";
import { AppQueryProvider } from "../query-provider";

notifyManager.setScheduler(queueMicrotask);

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

type Snapshot = NonNullable<NonNullable<ThreadPullsView["active"]>["snapshot"]>;
type CheckState = Snapshot["checks"][number]["state"];

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

let checkState: CheckState = "pending";
let failReads = false;
let reads = 0;
let extra: Partial<Snapshot> = {};
const logs = new Map<number, CheckLogView>();
let body = "";
const edits: unknown[] = [];
let draft = false;
const readied: boolean[] = [];
let noPull = false;
let ahead: number | null = 1;
let changed: string[] = [];
let earlier: ThreadPullsView["earlier"] = [];
let autofix = false;
let ignored: string[] = [];

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string) => {
        const job = /^\/code\/threads\/shelley%3At1\/pr\/checks\/(\d+)\/log$/.exec(path);
        if (job) {
          const log = logs.get(Number(job[1]));
          if (!log) throw new Error("not found");
          return log;
        }
        if (path === "/code/threads/shelley%3At1/review/files") {
          return changed.map((p) => ({
            path: p,
            status: "modified",
            additions: 1,
            deletions: 0,
            isGenerated: false,
            hash: "h",
            viewed: false,
          }));
        }
        if (!path.startsWith("/code/threads/shelley%3At1/pr"))
          throw new Error(`unexpected ${path}`);
        reads += 1;
        if (failReads) throw new Error("GitHub is down");
        return view(checkState);
      },
      post: async (path: string, body: { draft: boolean }) => {
        if (path !== "/code/threads/shelley%3At1/pr/draft") throw new Error(`unexpected ${path}`);
        readied.push(body.draft);
        draft = body.draft;
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
    draftPulls: true,
    branchPrefix: "ta/",
    protectedPaths: [],
    autofix: {
      triggers: { checks: true, reviews: true, conflicts: true },
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
    ahead,
    earlier,
    active: noPull
      ? null
      : {
          id: "pr1",
          number: 12,
          url: "https://github.com/o/r/pull/12",
          title: "Fix the login",
          state: "open",
          draft,
          headRef: "ta/fix-1a2b",
          baseRef: "main",
          syncedAt: null,
          autofix,
          loop: { status: autofix ? "watching" : "off", reason: null },
          stalled: [],
          ignored,
          passes: [],
          snapshot: {
            id: "n1",
            number: 12,
            url: "https://github.com/o/r/pull/12",
            title: "Fix the login",
            body,
            state: "open",
            draft,
            headRef: "ta/fix-1a2b",
            headSha: "abc",
            baseRef: "main",
            fromFork: false,
            headRepo: { owner: "acme", name: "web" },
            maintainerCanModify: false,
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
            ...extra,
          },
        },
  };
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  checkState = "pending";
  failReads = false;
  reads = 0;
  extra = {};
  logs.clear();
  body = "";
  edits.length = 0;
  draft = false;
  readied.length = 0;
  noPull = false;
  ahead = 1;
  changed = [];
  earlier = [];
  autofix = false;
  ignored = [];
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const panel = () => render(<PullPanel threadId="shelley:t1" refreshKey="k" onAttach={() => {}} />);

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("Code PR tab", () => {
  it("leads with its number, state, title and branch, then a checks bar", async () => {
    checkState = "success";
    panel();
    await wait(0);
    expect(screen.getByLabelText("Status")).toHaveTextContent("ta/fix-1a2b → main");
    expect(screen.getByText("open")).toBeInTheDocument();
    const bar = screen.getByRole("img", { name: "1 passed, 0 failed, 0 pending" });
    expect(bar).toBeInTheDocument();
  });

  it("re-reads the pull request every 15 seconds while it is on screen", async () => {
    panel();
    await wait(0);
    expect(screen.getByText("1 pending")).toBeInTheDocument();

    checkState = "success";
    await wait(15_000);
    expect(screen.getByText("1 passing")).toBeInTheDocument();
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
    expect(screen.getByText("1 passing")).toBeInTheDocument();
  });

  it("keeps what it shows when a background read fails, and the next read catches up", async () => {
    panel();
    await wait(0);
    failReads = true;
    await wait(15_000);
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.queryByText(/GitHub is down/)).toBeNull();

    failReads = false;
    checkState = "success";
    await wait(15_000);
    expect(screen.getByText("1 passing")).toBeInTheDocument();
  });
});

describe("getting it merged", () => {
  it("leads with the merged PR once a merge archived the thread, not with Publish (#383)", async () => {
    noPull = true;
    ahead = null;
    earlier = [
      {
        number: 12,
        url: "https://github.com/o/r/pull/12",
        title: "Fix the login",
        state: "merged",
      },
    ];
    panel();
    await wait(0);
    const merged = screen.getByRole("region", { name: "Merged" });
    expect(merged).toHaveTextContent("#12 Fix the login");
    expect(merged).toHaveTextContent("Branch ta/fix-1a2b is in main.");
    expect(screen.queryByTestId("code-publish")).toBeNull();
    expect(screen.queryByText("Earlier pull requests")).toBeNull();
  });

  it("switches a draft to ready for review, so Merge opens, and back to a draft", async () => {
    draft = true;
    checkState = "success";
    panel();
    await wait(0);
    const toggle = screen.getByRole("switch", { name: "Draft" });
    expect(toggle).toBeChecked();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    act(() => toggle.click());
    await wait(0);
    expect(screen.getByRole("switch", { name: "Draft" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled();
    act(() => screen.getByRole("switch", { name: "Draft" }).click());
    await wait(0);
    expect(readied).toEqual([false, true]);
    expect(screen.getByRole("switch", { name: "Draft" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("keeps Merge shut while a check fails or the branch conflicts, and says why", async () => {
    checkState = "failure";
    panel();
    await wait(0);
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByText("Merge opens once checks pass.")).toBeInTheDocument();

    extra = { mergeable: "conflicting" };
    act(() => screen.getByRole("button", { name: "Refresh" }).click());
    await wait(0);
    expect(
      screen.getByText("Merge opens once checks pass and the conflict is resolved."),
    ).toBeInTheDocument();

    checkState = "success";
    act(() => screen.getByRole("button", { name: "Refresh" }).click());
    await wait(0);
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByText("Merge opens once the conflict is resolved.")).toBeInTheDocument();

    extra = {};
    act(() => screen.getByRole("button", { name: "Refresh" }).click());
    await wait(0);
    expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled();
    expect(screen.queryByText(/Merge opens once/)).toBeNull();
  });

  it("says the changes are not committed yet, and asks the agent to commit them", async () => {
    noPull = true;
    ahead = 0;
    changed = ["src/a.ts", "src/b.ts"];
    const attached: string[] = [];
    render(
      <PullPanel threadId="shelley:t1" refreshKey="k" onAttach={(text) => attached.push(text)} />,
    );
    await wait(0);
    expect(screen.getByText("2 changed files are not committed yet.")).toBeInTheDocument();
    expect(screen.getByTestId("code-publish")).toBeDisabled();
    act(() => screen.getByRole("button", { name: "Ask to commit" }).click());
    expect(attached).toEqual(["Commit your changes on this branch."]);
  });
});

describe("only what can act shows (#384)", () => {
  it("a new PR: no Fix, no empty Comments, no Auto-fix status while it is off", async () => {
    checkState = "success";
    panel();
    await wait(0);
    expect(screen.getByRole("switch", { name: "Auto-fix" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
    expect(screen.queryByText("No comments yet.")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("no PR yet: the branch line leads, without a header repeating the tab's name", async () => {
    noPull = true;
    panel();
    await wait(0);
    expect(screen.queryByText("Pull request")).toBeNull();
    expect(screen.getByText(/is 1 commit ahead of main/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});

describe("the pull request's description", () => {
  it("reads as markdown, without the template's hidden comments", async () => {
    body =
      "<!-- This is a feature PR template -->\n\n## Feature Description\n\nSpeeds up **the API tests**.\n\n- `pytest-xdist` as a dev dependency";
    render(<PullPanel threadId="shelley:t1" refreshKey="1" onAttach={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("heading", { name: "Feature Description" })).toBeInTheDocument();
    expect(screen.getByText("the API tests")).toHaveAttribute("data-streamdown", "strong");
    expect(screen.getByText("pytest-xdist").tagName).toBe("CODE");
    expect(screen.queryByText(/<!--|## Feature/)).toBeNull();
  });

  it("edits the description and saves it to GitHub", async () => {
    body = "Old words";
    render(<PullPanel threadId="shelley:t1" refreshKey="1" onAttach={() => {}} />);
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

const user = (login: string, type: "user" | "bot" = "user") => ({
  login,
  type,
  association: "NONE",
});

describe("a check's log", () => {
  it("opens a failing check to what went wrong, with a link to the full log", async () => {
    extra = {
      checks: [
        {
          name: "Lint",
          state: "success",
          startedAt: "2026-11-17T10:00:00Z",
          completedAt: "2026-11-17T10:00:40Z",
          url: null,
          jobId: 76,
        },
        {
          name: "Unit tests",
          state: "failure",
          startedAt: "2026-11-17T10:00:00Z",
          completedAt: "2026-11-17T10:01:12Z",
          url: "https://github.com/o/r/actions/runs/5/job/77",
          jobId: 77,
        },
      ],
    };
    logs.set(77, {
      name: "Unit tests",
      url: "https://github.com/o/r/actions/runs/5/job/77",
      summary: "AssertionError: expected 401 to be 200",
      lines: [
        "FAIL tests/login.test.ts",
        "AssertionError: expected 401 to be 200",
        "Tests 1 failed",
      ],
      highlight: [0, 1],
      running: null,
    });
    panel();
    await wait(0);
    expect(screen.getByText("1 passing · 1 failing")).toBeInTheDocument();

    act(() => screen.getByRole("button", { name: /Unit tests/ }).click());
    await wait(0);
    const log = screen.getByRole("region", { name: "Unit tests log" });
    expect(log).toHaveTextContent("AssertionError: expected 401 to be 200");
    expect(log).toHaveTextContent("Tests 1 failed");
    expect(screen.getByRole("link", { name: "View full log" })).toHaveAttribute(
      "href",
      "https://github.com/o/r/actions/runs/5/job/77",
    );
    expect(screen.getByText("1m 12s")).toBeInTheDocument();
  });

  it("shows a running check's steps, then its log once GitHub has one", async () => {
    extra = {
      checks: [
        {
          name: "test",
          state: "pending",
          startedAt: "2026-11-17T10:00:00Z",
          completedAt: null,
          url: "https://github.com/o/r/actions/runs/5/job/77",
          jobId: 77,
        },
      ],
    };
    const base = { name: "test", url: "https://github.com/o/r/actions/runs/5/job/77" };
    logs.set(77, {
      ...base,
      summary: null,
      lines: [],
      highlight: [],
      running: [
        { number: 1, name: "Set up job", state: "success" },
        { number: 2, name: "Run pnpm test", state: "running" },
      ],
    });
    panel();
    await wait(0);
    act(() => screen.getByRole("button", { name: /test/ }).click());
    await wait(0);
    const region = screen.getByRole("region", { name: "test log" });
    expect(region).toHaveTextContent("Run pnpm test");
    expect(region).toHaveTextContent("The log excerpt shows here when the check finishes.");
    expect(region).not.toHaveTextContent("It may have expired");

    logs.set(77, { ...base, summary: null, lines: ["ok 1 passes"], highlight: [], running: null });
    await wait(5000);
    expect(region).toHaveTextContent("ok 1 passes");
    expect(region).not.toHaveTextContent("Run pnpm test");
  });
});

describe("the pull request's comments", () => {
  it("leaves out a duration GitHub cannot know (a status, or a check with no run time)", async () => {
    extra = {
      checks: [
        {
          name: "Cloudflare Pages",
          state: "success",
          startedAt: "2026-11-17T10:00:00Z",
          completedAt: "2026-11-17T10:00:00Z",
          url: null,
          jobId: null,
        },
      ],
    };
    panel();
    await wait(0);
    expect(screen.getByRole("button", { name: /Cloudflare Pages/ })).not.toHaveTextContent("0ms");
  });

  it("keeps the Auto-fix switch above a long comment list", async () => {
    extra = {
      comments: Array.from({ length: 8 }, (_, i) => ({
        id: `c${i}`,
        databaseId: i,
        author: user("github-actions", "bot"),
        body: `Tests passed (${i})`,
        createdAt: "2026-11-17T09:00:00Z",
      })),
    };
    panel();
    await wait(0);
    const comments = screen.getByRole("region", { name: "Comments" });
    const toggle = screen.getByRole("switch", { name: "Auto-fix" });
    expect(toggle.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("sorts every comment into All, Humans and Bots", async () => {
    extra = {
      comments: [
        {
          id: "c1",
          databaseId: 1,
          author: user("AshikNesin"),
          body: "Can we keep the old flag?",
          createdAt: "2026-11-17T09:00:00Z",
        },
        {
          id: "c2",
          databaseId: 2,
          author: user("coderabbitai", "bot"),
          body: "Walkthrough of the change",
          createdAt: "2026-11-17T09:05:00Z",
        },
      ],
      threads: [
        {
          id: "t1",
          path: "src/login.ts",
          line: 42,
          resolved: false,
          outdated: false,
          comments: [
            {
              id: "r1",
              databaseId: 3,
              author: user("greptile-apps"),
              body: "This null check is inverted.",
              createdAt: "2026-11-17T09:10:00Z",
            },
          ],
        },
      ],
    };
    panel();
    await wait(0);
    const comments = screen.getByRole("region", { name: "Comments" });
    expect(screen.getByRole("tab", { name: "All 3" })).toHaveAttribute("aria-selected", "true");
    expect(comments).toHaveTextContent("Can we keep the old flag?");
    expect(comments).toHaveTextContent("src/login.ts:42");

    act(() => screen.getByRole("tab", { name: "Bots 2" }).click());
    expect(comments).toHaveTextContent("Walkthrough of the change");
    expect(comments).toHaveTextContent("This null check is inverted.");
    expect(comments).not.toHaveTextContent("Can we keep the old flag?");

    act(() => screen.getByRole("tab", { name: "Humans 1" }).click());
    expect(comments).toHaveTextContent("Can we keep the old flag?");
    expect(comments).not.toHaveTextContent("Walkthrough of the change");
  });

  it("marks a teammate's review as skipped by Auto-fix only while Auto-fix is on (#385)", async () => {
    checkState = "success";
    ignored = ["rv1"];
    extra = {
      reviews: [
        {
          id: "rv1",
          author: user("carol"),
          state: "CHANGES_REQUESTED",
          body: "Please split this.",
          submittedAt: "2026-11-17T09:00:00Z",
        },
      ],
    };
    const { unmount } = panel();
    await wait(0);
    const comments = screen.getByRole("region", { name: "Comments" });
    expect(comments).toHaveTextContent("Please split this.");
    expect(comments).not.toHaveTextContent("Ignored");
    expect(comments).not.toHaveTextContent("Auto-fix skips");
    unmount();

    autofix = true;
    panel();
    await wait(0);
    expect(screen.getByRole("region", { name: "Comments" })).toHaveTextContent("Auto-fix skips");
  });

  it("folds a long comment (a bot's walkthrough) behind Show more", async () => {
    extra = {
      comments: [
        {
          id: "c1",
          databaseId: 1,
          author: user("coderabbitai", "bot"),
          body: `## Walkthrough\n\n${"The change keeps the session. ".repeat(40)}`,
          createdAt: "2026-11-17T09:05:00Z",
        },
      ],
    };
    panel();
    await wait(0);
    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    act(() => more.click());
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
