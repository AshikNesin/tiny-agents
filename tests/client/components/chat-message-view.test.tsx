/**
 * @vitest-environment jsdom
 *
 * Assistant turn rendering (ChatMessageView). Regression for the empty reply
 * card: a tool-only turn (trace rows, no text) must not paint the reply-card
 * surface once settled.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByText("list routines")).toBeInTheDocument();
  });

  it("renders the reply card for a settled turn with text", () => {
    render(<ChatMessageView message={msg({ text: "Done — deleted." })} {...base} />);
    expect(document.querySelector('[data-slot="reply-card"]')).toBeInTheDocument();
    expect(screen.getByText(/Done/)).toBeInTheDocument();
  });

  it("shows the thinking pulse for a streaming turn with no text yet", () => {
    render(<ChatMessageView message={msg({ status: "streaming" })} {...base} />);
    expect(screen.getByRole("status", { name: "thinking…" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="reply-card"]')).not.toBeInTheDocument();
  });

  it("lets a running tool row stand in for the thinking pulse", () => {
    render(
      <ChatMessageView
        message={msg({
          status: "streaming",
          toolCalls: [{ id: "t1", name: "list_routines", args: {}, status: "running" }],
        })}
        {...base}
      />,
    );
    expect(screen.queryByRole("status", { name: "thinking…" })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="reply-card"]')).not.toBeInTheDocument();
  });

  it("renders bot replies as plain text with no per-message avatar", () => {
    render(<ChatMessageView message={msg({ text: "hi there" })} {...base} />);
    const card = document.querySelector('[data-slot="reply-card"]');
    expect(card).toHaveAttribute("data-variant", "plain");
    expect(card).not.toHaveClass("bg-bubble");
    expect(document.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
  });

  it("renders the owner's message as a tinted bubble", () => {
    render(<ChatMessageView message={msg({ role: "user", text: "my question" })} {...base} />);
    const pill = screen.getByText("my question").parentElement;
    expect(pill).toHaveClass("bg-bubble-user");
    expect(document.querySelector('[data-slot="reply-card"]')).not.toBeInTheDocument();
  });

  it("renders the card with the error notice for a failed empty turn", () => {
    render(<ChatMessageView message={msg({ status: "error", error: "boom" })} {...base} />);
    const card = document.querySelector('[data-slot="reply-card"]');
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("boom");
  });
});

describe("a finished reply's work", () => {
  const calls = [
    {
      id: "t1",
      name: "list_routines",
      args: {},
      status: "done" as const,
      output: "[]",
      durationMs: 1200,
    },
    {
      id: "t2",
      name: "list_tasks",
      args: {},
      status: "error" as const,
      output: "boom",
      durationMs: 300,
    },
  ];

  it("folds into one line above the answer, and opens to show each step", () => {
    render(
      <ChatMessageView
        message={msg({
          text: "Two routines.",
          reasoning: "Check routines, then tasks",
          toolCalls: calls,
        })}
        {...base}
      />,
    );

    const work = screen.getByTestId("reply-work");
    expect(work).toHaveTextContent("Worked: list routines, list tasks");
    expect(work).toHaveTextContent("1 failed");
    expect(screen.getByText("Two routines.")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Worked: list routines, list tasks"));
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
  });

  it("stays unfolded while the bot is still working", () => {
    render(
      <ChatMessageView
        message={msg({ status: "streaming", reasoning: "Check routines", toolCalls: calls })}
        {...base}
      />,
    );
    expect(screen.queryByTestId("reply-work")).not.toBeInTheDocument();
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });
});
