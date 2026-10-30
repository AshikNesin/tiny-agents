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
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageView, toolAskLabel } from "@/components/ChatMessageView";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/bots-api", () => ({ botsApi: { decideApproval: vi.fn() } }));

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

function awaiting(name: string, args: Record<string, unknown> = {}): ChatMessage {
  const call: ChatToolCall = { id: "t1", name, args, status: "awaiting_approval", taskId: 7 };
  return { id: "m1", role: "assistant", text: "", status: "done", createdAt: 0, toolCalls: [call] };
}

function card(name: string, args?: Record<string, unknown>) {
  render(
    <ChatMessageView
      message={awaiting(name, args)}
      botName="E2E Test"
      botId="b1"
      toolLabels={toolLabels}
      toolAskLabels={toolAskLabels}
    />,
  );
  return document.querySelector('[data-waiting="approval:7"]')!;
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
