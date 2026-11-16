/**
 * Line comments that reached the agent read as comments in the thread: each
 * one names its file and lines, shows the lines it is about and what was
 * said, and the owner's own message follows, instead of the raw markdown the
 * agent was sent.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { TranscriptRow } from "@/pages/code/Transcript";

const sent =
  "Review comments (2):\n\n**`src/a.ts:2-3`**\n```\nb\nc\n```\nRename\n\nboth of them\n\n---\n\n" +
  "**`old.ts:7`** (old side)\nWhy?\n\n---\n\nThen run the tests";

const row = (text: string) => (
  <TranscriptRow
    item={{ kind: "user", id: "u1", text, attachments: [] }}
    ctx={{ instanceId: "shelley", rows: [] }}
    actions={{ recovery: [], recover: () => {}, respond: async () => {} }}
    isLastNotice={false}
  />
);

describe("comments sent to the agent, in the thread", () => {
  it("shows each comment as a card, then the message that went with them", () => {
    render(row(sent));
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("src/a.ts:2-3")).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/^b\s+c$/)).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent("Rename both of them");
    expect(within(cards[1]!).getByText("old.ts:7 (removed)")).toBeInTheDocument();
    expect(cards[1]).toHaveTextContent("Why?");
    expect(screen.getByText("Then run the tests")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("leaves an ordinary message as it is", () => {
    render(row("Review comments are welcome, **thanks**"));
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByText("Review comments are welcome, **thanks**")).toBeInTheDocument();
  });
});
