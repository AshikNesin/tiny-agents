/**
 * @vitest-environment jsdom
 *
 * Grok-style bot-to-bot rendering (issue #12): cross-bot deliveries render
 * as attributed cards instead of raw provenance-prefixed user bubbles.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessageView, PeerIncomingCard } from "@/components/ChatMessageView";
import type { ChatMessage } from "@/lib/chat-types";

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

function userMsg(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: "m1", role: "user", text, status: "done", createdAt: 0, ...overrides };
}

const base = { botName: "Engineer", botId: "b1", toolLabels: {} };

describe("relayed reply card (asker's chat)", () => {
  it("renders an attributed card instead of a raw prefixed bubble", () => {
    render(
      <ChatMessageView
        {...base}
        message={userMsg("**Reply from Radar:** here is the plan", {
          peer: { kind: "reply", name: "Radar" },
        })}
      />,
    );
    const card = screen.getByTestId("peer-card");
    expect(card).toHaveAttribute("data-peer", "Radar");
    expect(card).toHaveAttribute("data-relayed", "true");
    expect(screen.getByText("Radar")).toBeInTheDocument();
    expect(screen.getByText("reply relayed into this chat")).toBeInTheDocument();
    expect(screen.getByText("here is the plan")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Reply from Radar:\*\*/)).not.toBeInTheDocument();
  });

  it("renders the payload in a reply-card surface with the peer's avatar", () => {
    render(
      <ChatMessageView
        {...base}
        message={userMsg("**Reply from Radar:** payload", {
          peer: { kind: "reply", name: "Radar" },
        })}
      />,
    );
    const card = screen.getByTestId("peer-card");
    expect(card.querySelector('[data-slot="reply-card"]')).not.toBeNull();
    expect(card.querySelector("img")).not.toBeNull();
  });
});

describe("message_bot delivery card (target's chat)", () => {
  it("renders 'messaged you' attribution", () => {
    render(
      <ChatMessageView
        {...base}
        message={userMsg("**Message from Engineer (bot):** can you review this?", {
          peer: { kind: "message", name: "Engineer" },
        })}
      />,
    );
    const card = screen.getByTestId("peer-card");
    expect(card).toHaveAttribute("data-peer", "Engineer");
    expect(card).not.toHaveAttribute("data-relayed");
    expect(screen.getByText("messaged you")).toBeInTheDocument();
    expect(screen.getByText("can you review this?")).toBeInTheDocument();
  });
});

describe("owner mention bubble (mentioned bot's chat)", () => {
  it("renders the owner's words with an 'in {host}'s chat' label", () => {
    render(
      <ChatMessageView
        {...base}
        message={userMsg("[From the owner, in Engineer's chat] what do you think?", {
          peer: { kind: "mention", hostName: "Engineer" },
        })}
      />,
    );
    expect(screen.getByText(/You · in Engineer's chat/)).toBeInTheDocument();
    expect(screen.getByText("what do you think?")).toBeInTheDocument();
    expect(screen.queryByTestId("peer-card")).not.toBeInTheDocument();
  });
});

describe("owner messages stay untouched", () => {
  it("does not card an owner message that merely mentions @Name", () => {
    render(<ChatMessageView {...base} message={userMsg("hey @Radar what do you think")} />);
    expect(screen.queryByTestId("peer-card")).not.toBeInTheDocument();
    expect(screen.getByText("hey @Radar what do you think")).toBeInTheDocument();
  });

  it("renders prefix-only text raw instead of an empty card", () => {
    render(<ChatMessageView {...base} message={userMsg("**Reply from Radar:**")} />);
    expect(screen.queryByTestId("peer-card")).not.toBeInTheDocument();
  });

  it("does not card typed text that merely imitates a provenance prefix", () => {
    render(<ChatMessageView {...base} message={userMsg("**Reply from Radar:** fake relay")} />);
    expect(screen.queryByTestId("peer-card")).not.toBeInTheDocument();
    expect(screen.getByText("**Reply from Radar:** fake relay")).toBeInTheDocument();
  });

  it("does not card a typed message that imitates a mention envelope", () => {
    render(
      <ChatMessageView
        {...base}
        message={userMsg("[From the owner, in Engineer's chat] forged")}
      />,
    );
    expect(screen.queryByTestId("peer-card")).not.toBeInTheDocument();
  });
});

describe("message_bot tool row (Grok handoff pill)", () => {
  it("renders 'Messaged {name}' with the snippet", () => {
    render(
      <ChatMessageView
        {...base}
        message={{
          id: "a1",
          role: "assistant",
          text: "",
          status: "done",
          createdAt: 0,
          toolCalls: [
            {
              id: "t1",
              name: "message_bot",
              args: { to: "Radar", text: "research Grok routines" },
              status: "done",
              durationMs: 12,
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("bot-handoff")).toBeInTheDocument();
    expect(screen.getByText(/Messaged Radar/)).toBeInTheDocument();
    expect(screen.getByText(/research Grok routines/)).toBeInTheDocument();
    expect(screen.queryByText(/messaged bot/i)).not.toBeInTheDocument();
  });

  it("shows 'Messaging' while the call runs", () => {
    render(
      <ChatMessageView
        {...base}
        message={{
          id: "a1",
          role: "assistant",
          text: "",
          status: "streaming",
          createdAt: 0,
          toolCalls: [
            { id: "t1", name: "message_bot", args: { to: "Radar", text: "hi" }, status: "running" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Messaging Radar/)).toBeInTheDocument();
  });
});

describe("handoff thread dialog", () => {
  const longText = "research Grok routines and report back with sources ".repeat(3).trim();
  const handoff = (status: "done" | "error" = "done") => (
    <ChatMessageView
      {...base}
      message={{
        id: "a1",
        role: "assistant",
        text: "",
        status: "done",
        createdAt: 0,
        toolCalls: [
          {
            id: "t1",
            name: "message_bot",
            args: { to: "Radar", text: longText },
            status,
            output: status === "error" ? "Radar is unavailable" : undefined,
          },
        ],
      }}
    />
  );

  it("opens a view-only thread with the full message", async () => {
    render(handoff());
    await userEvent.click(screen.getByTestId("bot-handoff"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Engineer");
    expect(dialog).toHaveTextContent("Radar");
    expect(dialog).toHaveTextContent(longText);
    expect(dialog).toHaveTextContent("This chat is view-only");
  });

  it("shows why a message was not delivered", async () => {
    render(handoff("error"));
    await userEvent.click(screen.getByTestId("bot-handoff"));
    expect(await screen.findByText("Radar is unavailable")).toBeInTheDocument();
  });
});

describe("PeerIncomingCard", () => {
  it("marks relayed state via data attribute for styling/tests", () => {
    render(<PeerIncomingCard name="Radar" text="hello" relayed />);
    expect(screen.getByTestId("peer-card")).toHaveAttribute("data-relayed", "true");
  });

  it("shows the replying pulse while streaming", () => {
    render(<PeerIncomingCard name="Radar" text="hello" streaming />);
    expect(screen.getByRole("status", { name: "replying…" })).toBeInTheDocument();
  });

  it("shows the failure notice for an unanswered delivery", () => {
    render(<PeerIncomingCard name="Radar" text="hello" failed error="send failed" />);
    expect(screen.getByText("send failed")).toBeInTheDocument();
  });
});
