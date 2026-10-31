/**
 * @vitest-environment jsdom
 *
 * Approval card wording (issue #85): the sentence is "<bot> wants to <ask>",
 * built from the tool's imperative label, never its past-tense done-label
 * ("wants to opened a page"). Tools without one (connection tools) read
 * "wants to use <display name>".
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageView, toolAskLabel } from "@/components/ChatMessageView";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";
import { OwnerActionsProvider, type OwnerActions } from "@/lib/owner-actions";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// A recording fake: the cards act only through the owner actions in scope.
const decideApproval = vi.fn();
const actions: OwnerActions = {
  decideApproval: (...args) => decideApproval(...args),
  answerQuestions: vi.fn(),
};

const toolLabels = {
  browser_navigate: "Opened a page",
  delete_task: "Deleted task",
  run_routine_now: "Ran routine now",
  mcp__notion__search_pages: "Search pages",
};
const toolAskLabels = {
  browser_navigate: "open a page",
  delete_task: "delete a task",
  run_routine_now: "run a routine now",
};

function awaiting(
  name: string,
  args: Record<string, unknown> = {},
  extra: Partial<ChatToolCall> = {},
): ChatMessage {
  const call: ChatToolCall = {
    id: "t1",
    name,
    args,
    status: "awaiting_approval",
    taskId: 7,
    ...extra,
  };
  return { id: "m1", role: "assistant", text: "", status: "done", createdAt: 0, toolCalls: [call] };
}

function card(
  name: string,
  args?: Record<string, unknown>,
  { owner = actions, extra }: { owner?: OwnerActions; extra?: Partial<ChatToolCall> } = {},
) {
  render(
    <OwnerActionsProvider actions={owner}>
      <ChatMessageView
        message={awaiting(name, args, extra)}
        botName="E2E Test"
        toolLabels={toolLabels}
        toolAskLabels={toolAskLabels}
      />
    </OwnerActionsProvider>,
  );
  return document.querySelector('[data-waiting="approval:7"]');
}

describe("ApprovalCard wording", () => {
  it("says what the bot wants to do in the imperative", () => {
    expect(card("browser_navigate", { url: "https://example.com" })).toHaveTextContent(
      "E2E Test wants to open a page — “https://example.com”",
    );
  });

  it.each([
    ["delete_task", "E2E Test wants to delete a task"],
    ["run_routine_now", "E2E Test wants to run a routine now"],
  ])("reads naturally for %s", (name, sentence) => {
    expect(card(name)).toHaveTextContent(sentence);
    expect(screen.queryByText(/wants to (deleted|ran)/)).toBeNull();
  });

  it("falls back to 'use <tool>' for tools without an imperative label", () => {
    expect(card("mcp__notion__search_pages")).toHaveTextContent(
      "E2E Test wants to use Search pages",
    );
    // Not in the catalog at all: the prettified connection tool name.
    expect(toolAskLabel({}, {}, "mcp__linear__create_issue")).toBe("use Create Issue via linear");
  });
});

describe("approval cards act through the owner actions", () => {
  const user = userEvent.setup();
  beforeEach(() => {
    decideApproval.mockReset();
    decideApproval.mockResolvedValue(undefined);
  });

  it("approves, denies and always-allows a tool call", async () => {
    card("delete_task");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Deny" }));
    await user.click(screen.getByRole("button", { name: "Always allow" }));
    expect(decideApproval.mock.calls).toEqual([
      [7, "approved", { alwaysAllow: undefined }],
      [7, "denied", { alwaysAllow: undefined }],
      [7, "approved", { alwaysAllow: "delete_task" }],
    ]);
  });

  it("grants a vault item for the rest of the chat", async () => {
    card(
      "browser_fill_secret",
      {},
      {
        extra: {
          vault: {
            tool: "browser_fill_secret",
            handle: "vault:github",
            label: "GitHub login",
            kind: "login",
            target: "github.com",
            grantable: true,
          },
        },
      },
    );
    await user.click(screen.getByRole("button", { name: "For this chat" }));
    expect(decideApproval).toHaveBeenCalledWith(7, "approved", { grant: true });
  });

  it("renders no card without owner actions (a past chat)", () => {
    render(
      <ChatMessageView
        message={awaiting("delete_task")}
        botName="E2E Test"
        toolLabels={toolLabels}
      />,
    );
    expect(document.querySelector('[data-waiting="approval:7"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByText(/not answered/)).toBeInTheDocument();
  });
});
