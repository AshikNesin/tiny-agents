/**
 * The Code page's thread list (issue #143, ADR 0011): one line per thread,
 * subagents nested, Archive on a row moves the thread together with its
 * subagents (the server cascades; the toast says how many, with Undo), and
 * a harness that cannot archive offers no Archive. Select mode (issue #148)
 * archives many threads at once.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { ConversationList } from "@/pages/code/ConversationList";
import type { HarnessInfo, ThreadSummary } from "@/lib/code/api";

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

beforeEach(() => {
  archiveMock.mockReset();
  toastSuccess.mockReset();
});

describe("Code thread list", () => {
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
    await userEvent.click(screen.getByRole("button", { name: "Select threads" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Select threads" }));
    const bar = screen.getByRole("toolbar", { name: "Selected threads" });
    expect(within(bar).getByRole("button", { name: "Archive" })).toBeDisabled();
    await userEvent.click(within(bar).getByRole("button", { name: "Select all" }));
    expect(within(bar).getByText("3 selected")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(within(bar).getByText("Select threads")).toBeInTheDocument();
  });
});
