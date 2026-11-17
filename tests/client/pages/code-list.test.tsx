/**
 * The Code page's thread list (issue #143, ADR 0011): one line per thread,
 * subagents nested, Archive on a row moves the thread together with its
 * subagents (the server cascades; the toast says how many, with Undo), and
 * a harness that cannot archive offers no Archive. Select mode (issue #148)
 * archives many threads at once. Threads are grouped by project, then by
 * folder, each group with its own New thread.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { ConversationList } from "@/pages/code/ConversationList";
import type { HarnessInfo, ThreadSummary } from "@/lib/code/api";
import type { ProjectView } from "../../../apps/web/src/shared/api/code";

const archiveMock = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));

vi.mock("@/lib/code/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/code/api")>();
  return {
    ...original,
    codeApi: {
      ...original.codeApi,
      archive: (...args: unknown[]) => archiveMock(...args),
      list: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
    },
  };
});

const shelley: HarnessInfo = {
  id: "shelley",
  kind: "shelley",
  label: "Shelley",
  status: { state: "connected" },
  capabilities: {
    ...NO_CAPABILITIES,
    threads: { ...NO_CAPABILITIES.threads, archive: true, search: true, subagents: true },
  },
  commands: [],
};
const claude: HarnessInfo = {
  ...shelley,
  id: "claude-code",
  kind: "claude-code",
  label: "Claude Code",
  capabilities: NO_CAPABILITIES,
};

const row = (id: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: `shelley:${id}`,
  instanceId: "shelley",
  kind: "shelley",
  nativeId: id,
  title: id,
  cwd: "/home/exedev/app",
  model: "predictable",
  parentId: null,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: new Date().toISOString(),
  working: false,
  archived: false,
  cursor: 0,
  ...extra,
});

const project = (id: string, name: string): ProjectView => ({
  id,
  name,
  repo: { owner: "AshikNesin", name },
  transport: "gh",
  baseBranch: "main",
  checkoutPath: `/home/exedev/tiny-agents-code/AshikNesin--${name}/checkout`,
  defaultInstanceId: null,
  defaultModel: null,
  settings: {
    scripts: {},
    archiveOnMerge: true,
    branchPrefix: "ta/",
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
});

const openMenuItem = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: "List options" }));
  await userEvent.click(screen.getByRole("menuitem", { name }));
};

beforeEach(() => {
  window.localStorage.clear();
  archiveMock.mockReset();
  toastSuccess.mockReset();
});

describe("Code thread list", () => {
  it("shows a pull request only when it needs you (the Threads screen shows them all)", () => {
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley]}
          threads={[
            row("fixing-ci", { pr: { number: 12, loop: "needs_input" } }),
            row("merged-one", { pr: { number: 9, loop: "merged" } }),
            row("no-pr"),
          ]}
        />
      </MemoryRouter>,
    );
    const rowOf = (title: string) =>
      screen.getAllByTestId("code-conversation-row").find((r) => r.textContent?.includes(title))!;
    expect(
      within(rowOf("fixing-ci")).getByLabelText("Pull request #12, needs you"),
    ).toHaveTextContent("#12");
    expect(within(rowOf("merged-one")).queryByText(/#\d/)).toBeNull();
    expect(within(rowOf("no-pr")).queryByText(/#\d/)).toBeNull();
  });

  it("archives a thread with its subagents, offering Undo", async () => {
    archiveMock.mockResolvedValue({ moved: ["shelley:child", "shelley:grandchild"] });
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley]}
          threads={[
            row("parent"),
            row("child", { parentId: "shelley:parent" }),
            row("grandchild", { parentId: "shelley:child" }),
            row("other"),
          ]}
        />
      </MemoryRouter>,
    );
    const archive = screen.getByRole("button", { name: "Archive parent" });
    expect(archive).toHaveAttribute("title", "Archive with 2 subagents");
    await userEvent.click(archive);
    expect(archiveMock).toHaveBeenCalledWith("shelley:parent", true);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick(): void } },
    ];
    expect(message).toBe("Archived “parent” and 2 subagents");
    expect(options.action.label).toBe("Undo");
    archiveMock.mockResolvedValue({ moved: [] });
    options.action.onClick();
    expect(archiveMock).toHaveBeenLastCalledWith("shelley:parent", false);
  });

  it("shows one line per thread with subagents nested and a short time", () => {
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley]}
          threads={[
            row("parent", { preview: "All done" }),
            row("child", { parentId: "shelley:parent", working: true }),
          ]}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByTestId("code-conversation-row");
    expect(rows.map((r) => r.textContent)).toEqual(["parentnow", "childnow"]);
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
  });

  it("labels each harness's threads and offers Archive only where the harness archives", () => {
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley, claude]}
          threads={[
            row("s1"),
            row("c1", { id: "claude-code:c1", instanceId: "claude-code", kind: "claude-code" }),
          ]}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByTestId("code-conversation-row");
    expect(rows.map((r) => r.textContent).sort()).toEqual(["c1Claude Codenow", "s1Shelleynow"]);
    expect(screen.getByRole("button", { name: "Archive s1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive c1" })).toBeNull();
  });

  it("selects several threads and archives them at once, with one Undo", async () => {
    archiveMock.mockImplementation(async (id: string) => ({
      moved: id === "shelley:parent" ? ["shelley:child"] : [],
    }));
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley, claude]}
          threads={[
            row("parent"),
            row("child", { parentId: "shelley:parent" }),
            row("other"),
            row("kept"),
            row("c1", { id: "claude-code:c1", instanceId: "claude-code", kind: "claude-code" }),
          ]}
        />
      </MemoryRouter>,
    );
    await openMenuItem("Select threads");
    // Rows become checkboxes; a harness that cannot archive offers none.
    expect(screen.queryByRole("checkbox", { name: "Select c1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive parent" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select parent" }));
    // The subagent goes along with its parent: ticked, not its own pick.
    const child = screen.getByRole("checkbox", { name: "Select child" });
    expect(child).toBeChecked();
    expect(child).toBeDisabled();
    // A click on the row picks it instead of opening it.
    const other = screen
      .getAllByTestId("code-conversation-row")
      .find((r) => r.textContent?.startsWith("other"))!;
    await userEvent.click(other);
    const bar = screen.getByRole("toolbar", { name: "Selected threads" });
    expect(within(bar).getByText("2 selected + 1 subagent")).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // Only the topmost picks are sent: the server moves subagents itself.
    expect(archiveMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      "shelley:other",
      "shelley:parent",
    ]);
    expect(archiveMock.mock.calls.every((c) => c[1] === true)).toBe(true);
    const [message, options] = toastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick(): void } },
    ];
    expect(message).toBe("Archived 2 threads and 1 subagent");
    // Done: Select mode ends.
    expect(screen.queryByRole("toolbar", { name: "Selected threads" })).toBeNull();

    archiveMock.mockClear();
    options.action.onClick();
    expect(archiveMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      "shelley:other",
      "shelley:parent",
    ]);
    expect(archiveMock.mock.calls.every((c) => c[1] === false)).toBe(true);
  });

  it("selects every archivable thread with Select all", async () => {
    render(
      <MemoryRouter>
        <ConversationList harnesses={[shelley]} threads={[row("a"), row("b"), row("c")]} />
      </MemoryRouter>,
    );
    await openMenuItem("Select threads");
    const bar = screen.getByRole("toolbar", { name: "Selected threads" });
    expect(within(bar).getByRole("button", { name: "Archive" })).toBeDisabled();
    await userEvent.click(within(bar).getByRole("button", { name: "Select all" }));
    expect(within(bar).getByText("3 selected")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(within(bar).getByText("Select threads")).toBeInTheDocument();
  });

  it("groups by repository by default, and lists every thread flat, newest first, with it off", async () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley]}
          projects={[project("p1", "tiny-agents")]}
          threads={[
            row("older", { projectId: "p1", updatedAt: ago(90) }),
            row("newest", { cwd: "/home/exedev/notes", updatedAt: ago(1) }),
            row("middle", { projectId: "p1", updatedAt: ago(30) }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId("code-group")).toHaveLength(2);
    // The list's options sit behind one menu; grouping is on.
    await userEvent.click(screen.getByRole("button", { name: "List options" }));
    const group = screen.getByRole("menuitemcheckbox", { name: "Group by repository" });
    expect(group).toHaveAttribute("aria-checked", "true");
    // Off: no folder headers, one list, newest first.
    await userEvent.click(group);
    expect(screen.queryAllByTestId("code-group")).toHaveLength(0);
    expect(
      screen
        .getAllByTestId("code-conversation-row")
        .map((r) => r.textContent?.replace(/\d+[mh]$/, "")),
    ).toEqual(["newest", "middle", "older"]);
    // Search sits behind an icon.
    expect(screen.queryByRole("textbox", { name: "Search threads" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Search threads" }));
    // Nothing typed: leaving the box puts the Search row back.
    expect(screen.getByRole("textbox", { name: "Search threads" })).toHaveFocus();

    // The choice is remembered in this browser.
    expect(window.localStorage.getItem("tiny-agents:code-grouped")).toBe("0");
  });

  it("groups threads by project, then by folder, each group with its own New thread", async () => {
    render(
      <MemoryRouter>
        <ConversationList
          harnesses={[shelley]}
          projects={[project("p1", "tiny-agents"), project("p2", "quiet")]}
          threads={[
            row("fix-login", { projectId: "p1" }),
            row("scratch", { cwd: "/home/exedev/notes" }),
            row("add-tests", { projectId: "p1" }),
          ]}
        />
      </MemoryRouter>,
    );
    const titles = (name: string) =>
      within(screen.getByRole("region", { name }))
        .queryAllByTestId("code-conversation-row")
        .map((r) => r.textContent)
        .sort();
    expect(titles("tiny-agents")).toEqual(["add-testsnow", "fix-loginnow"]);
    expect(titles("notes")).toEqual(["scratchnow"]);
    // A project with no threads yet is still there to start one in.
    expect(titles("quiet")).toEqual([]);
    expect(screen.getByRole("link", { name: "New thread in tiny-agents" })).toHaveAttribute(
      "href",
      "/code/new?project=p1",
    );
    expect(screen.getByRole("link", { name: "New thread in notes" })).toHaveAttribute(
      "href",
      "/code/new?cwd=%2Fhome%2Fexedev%2Fnotes",
    );
    expect(screen.getByRole("link", { name: "tiny-agents settings" })).toHaveAttribute(
      "href",
      "/code/settings/projects/p1",
    );

    // A group folds away.
    await userEvent.click(screen.getByRole("button", { name: "tiny-agents", expanded: true }));
    expect(titles("tiny-agents")).toEqual([]);
    expect(
      screen.getByRole("button", { name: "tiny-agents", expanded: false }),
    ).toBeInTheDocument();
  });
});
