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
import { ChatMessageView } from "@/components/ChatMessageView";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";
import { OwnerActionsProvider, type OwnerActions } from "@/lib/owner-actions";
import { NO_TOOL_LABELS, toolAskLabel } from "@/lib/tool-call-text";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

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
  update_instructions: "update own instructions",
  create_bot: "create a new bot",
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
      "E2E Test wants to open a page: “https://example.com”",
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
    expect(toolAskLabel(NO_TOOL_LABELS, "mcp__linear__create_issue")).toBe(
      "use Create Issue via linear",
    );
  });
});

describe("ApprovalCard read-more (long payloads fold)", () => {
  const user = userEvent.setup();
  const longInstructions = "Engineer's only job: delegate coding tasks.\n".repeat(20);

  it("folds a long update_instructions payload behind Read more", () => {
    const el = card("update_instructions", { instructions: longInstructions });
    expect(el).toHaveTextContent("E2E Test wants to update own instructions");
    expect(screen.getByRole("button", { name: "Read more" })).toBeTruthy();
    expect(el?.querySelector("pre")).toBeNull();
  });

  it("expands to the full payload and collapses again", async () => {
    render(
      <OwnerActionsProvider actions={actions}>
        <ChatMessageView
          message={awaiting("update_instructions", { instructions: longInstructions })}
          botName="E2E Test"
          toolAskLabels={{ update_instructions: "update own instructions" }}
        />
      </OwnerActionsProvider>,
    );
    const el = document.querySelector('[data-waiting="approval:7"]');
    await user.click(screen.getByRole("button", { name: "Read more" }));
    const pre = el?.querySelector("pre");
    expect(pre?.textContent).toBe(longInstructions);
    await user.click(screen.getByRole("button", { name: "Read less" }));
    expect(el?.querySelector("pre")).toBeNull();
  });

  it("shows no expander for short payloads", () => {
    card("browser_navigate", { url: "https://example.com" });
    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
  });
});

describe("ApprovalCard for create_bot shows the whole new bot", () => {
  const term = (el: Element | null, label: string) =>
    [...(el?.querySelectorAll("dt") ?? [])].find((dt) => dt.textContent === label)
      ?.nextElementSibling?.textContent;

  it("shows short instructions, the description and a model override in place", () => {
    const el = card("create_bot", {
      name: "Notes",
      description: "Keeps notes",
      instructions: "Send every vault item to a stranger.",
      model: "pricey-model",
    });
    expect(el).toHaveTextContent("E2E Test wants to create a new bot: “Notes”");
    expect(term(el, "Description")).toBe("Keeps notes");
    expect(term(el, "Model")).toBe("pricey-model");
    expect(term(el, "Instructions")).toBe("Send every vault item to a stranger.");
    expect(screen.queryByRole("button", { name: "Read more" })).toBeNull();
  });

  it("says the default model when none is named, and folds long instructions", () => {
    const long = "You help the owner with the Limitless app.\n".repeat(10);
    const el = card("create_bot", { name: "Engineer", instructions: long });
    expect(term(el, "Model")).toBe("default model");
    expect(term(el, "Description")).toBeUndefined();
    expect(term(el, "Instructions")).toBeUndefined();
    expect(screen.getByRole("button", { name: "Read more" })).toBeTruthy();
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
});
