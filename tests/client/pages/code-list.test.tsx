/**
 * The Code page's conversation list (issue #143): one line per conversation,
 * subagents nested, and Archive on a row moves the conversation together
 * with its subagents (the server cascades; the toast says how many, with Undo).
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ConversationList } from "@/pages/code/ConversationList";
import type { ShelleyConversation } from "@/lib/shelley/api";

const actionMock = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));

vi.mock("@/lib/shelley/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/shelley/api")>();
  return {
    ...original,
    shelleyApi: {
      ...original.shelleyApi,
      action: (...args: unknown[]) => actionMock(...args),
      list: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
    },
  };
});

const row = (id: string, extra: Partial<ShelleyConversation> = {}): ShelleyConversation => ({
  conversation_id: id,
  slug: id,
  cwd: "/home/exedev/app",
  model: "predictable",
  created_at: "2026-11-03T10:00:00Z",
  updated_at: new Date().toISOString(),
  parent_conversation_id: null,
  working: false,
  ...extra,
});

beforeEach(() => {
  actionMock.mockReset();
  toastSuccess.mockReset();
});

describe("Code conversation list", () => {
  it("archives a conversation with its subagents, offering Undo", async () => {
    actionMock.mockResolvedValue({ subagents: ["child", "grandchild"] });
    render(
      <MemoryRouter>
        <ConversationList
          conversations={[
            row("parent"),
            row("child", { parent_conversation_id: "parent" }),
            row("grandchild", { parent_conversation_id: "child" }),
            row("other"),
          ]}
        />
      </MemoryRouter>,
    );
    const archive = screen.getByRole("button", { name: "Archive parent" });
    expect(archive).toHaveAttribute("title", "Archive with 2 subagents");
    await userEvent.click(archive);
    expect(actionMock).toHaveBeenCalledWith("parent", "archive");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0] as [
      string,
      { action: { label: string; onClick(): void } },
    ];
    expect(message).toBe("Archived “parent” and 2 subagents");
    expect(options.action.label).toBe("Undo");
    actionMock.mockResolvedValue({ subagents: [] });
    options.action.onClick();
    expect(actionMock).toHaveBeenLastCalledWith("parent", "unarchive");
  });

  it("shows one line per conversation with subagents nested and a short time", () => {
    render(
      <MemoryRouter>
        <ConversationList
          conversations={[
            row("parent", { preview: "All done" }),
            row("child", { parent_conversation_id: "parent", working: true }),
          ]}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByTestId("code-conversation-row");
    expect(rows.map((r) => r.textContent)).toEqual(["parentnow", "childnow"]);
    // The preview moves to the tooltip: the list stays one line per task.
    expect(rows[0]).toHaveAttribute("title", "All done");
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
  });
});
