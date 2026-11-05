/**
 * The Code page's thread list (issue #143, ADR 0011): one line per thread,
 * subagents nested, Archive on a row moves the thread together with its
 * subagents (the server cascades; the toast says how many, with Undo), and
 * a harness that cannot archive offers no Archive.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
});
