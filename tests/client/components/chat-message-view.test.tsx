/**
 * @vitest-environment jsdom
 *
 * Assistant turn rendering (ChatMessageView). Regression for the empty reply
 * card: a tool-only turn (trace rows, no text) must not paint the reply-card
 * surface once settled.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageView } from "@/components/ChatMessageView";
import type { ChatMessage } from "@/lib/chat-types";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    text: "",
    status: "done",
    createdAt: 0,
    ...overrides,
  };
}

const base = {
  botName: "Chief",
  botId: "b1",
  toolLabels: {},
};

describe("ChatMessageView reply card", () => {
  it("does not render a reply card for a settled tool-only turn", () => {
    render(
      <ChatMessageView
        message={msg({
          toolCalls: [
            {
              id: "t1",
              name: "list_routines",
              args: {},
              status: "done",
              output: "[]",
              durationMs: 2,
            },
          ],
        })}
        {...base}
      />,
    );
    expect(document.querySelector('[data-slot="reply-card"]')).not.toBeInTheDocument();
    // The trace row is still visible.
    expect(screen.getByText("list routines")).toBeInTheDocument();
  });

  it("renders the reply card for a settled turn with text", () => {
    render(<ChatMessageView message={msg({ text: "Done — deleted." })} {...base} />);
    expect(document.querySelector('[data-slot="reply-card"]')).toBeInTheDocument();
    expect(screen.getByText(/Done/)).toBeInTheDocument();
  });

  it("shows the thinking pulse for a streaming turn with no text yet", () => {
    render(
      <ChatMessageView
        message={msg({
          status: "streaming",
          toolCalls: [{ id: "t1", name: "list_routines", args: {}, status: "running" }],
        })}
        {...base}
      />,
    );
    expect(screen.getByText("thinking…")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="reply-card"]')).not.toBeInTheDocument();
  });

  it("renders the card with the error notice for a failed empty turn", () => {
    render(<ChatMessageView message={msg({ status: "error", error: "boom" })} {...base} />);
    const card = document.querySelector('[data-slot="reply-card"]');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("boom");
  });
});
