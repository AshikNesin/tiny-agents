/**
 * @vitest-environment jsdom
 *
 * The Transcript module shared by the live chat and Past chats: older pages
 * load from its page source only on the owner's own scrolling, one at a
 * time; and a Past chat (no owner actions) shows its waiting cards without
 * actions.
 */
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { Transcript, type TranscriptPages } from "@/components/Transcript";
import { PastChatPane } from "@/components/PastChatPane";
import { MessageScrollerProvider } from "@/components/ui/message-scroller";
import type { Bot } from "@/lib/bots-api";
import { chatTimeline } from "@/lib/chat-timeline";
import type { ChatMessage } from "@/lib/chat-types";

const pastChatMock = vi.fn();
vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    capabilities: vi.fn().mockResolvedValue([]),
    pastChat: (...args: unknown[]) => pastChatMock(...args),
    pastChatHistory: vi.fn(),
    pastChats: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(() => cleanup());

const msg = (n: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `e${n}`,
  role: n % 2 ? "user" : "assistant",
  text: `message ${n}`,
  status: "done",
  createdAt: Date.UTC(2026, 9, 30, 12, n),
  ...extra,
});

/** A fake page source: two pages in memory, the older one loads on demand. */
function PagedTranscript({ loadOlder }: { loadOlder: (before: string) => Promise<ChatMessage[]> }) {
  const [pages, setPages] = useState({ messages: [msg(3), msg(4)], hasMore: true });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const source: TranscriptPages = {
    hasMore: pages.hasMore,
    loadingOlder,
    loadOlder: async () => {
      setLoadingOlder(true);
      const older = await loadOlder(pages.messages[0].id);
      setPages((current) => ({ messages: [...older, ...current.messages], hasMore: false }));
      setLoadingOlder(false);
    },
  };
  return (
    <MessageScrollerProvider>
      <Transcript botName="Chief" timeline={chatTimeline(pages.messages, [])} pages={source} />
    </MessageScrollerProvider>
  );
}

function viewport(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]')!;
}

describe("Transcript paging", () => {
  it("loads the page above only after the owner scrolls, once, and renders it in order", async () => {
    let resolve!: (older: ChatMessage[]) => void;
    const loadOlder = vi.fn(
      () =>
        new Promise<ChatMessage[]>((r) => {
          resolve = r;
        }),
    );
    render(<PagedTranscript loadOlder={loadOlder} />);
    expect(screen.getByTestId("older-messages")).toHaveTextContent("Earlier messages");

    // The scroller's own jump to the latest message never loads a page.
    fireEvent.scroll(viewport());
    expect(loadOlder).not.toHaveBeenCalled();

    // The owner's wheel at the top asks for the page above.
    fireEvent.wheel(viewport());
    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(loadOlder).toHaveBeenCalledWith("e3");
    expect(await screen.findByText("Loading earlier messages…")).toBeInTheDocument();

    // While it loads, more scrolling does not ask again.
    fireEvent.scroll(viewport());
    fireEvent.wheel(viewport());
    expect(loadOlder).toHaveBeenCalledTimes(1);

    await act(async () => resolve([msg(1), msg(2)]));
    expect(screen.queryByTestId("older-messages")).toBeNull();
    const texts = screen.getAllByText(/^message \d$/).map((el) => el.textContent);
    expect(texts).toEqual(["message 1", "message 2", "message 3", "message 4"]);
  });

  it("shows the empty slot only when there is nothing to show", () => {
    const pages: TranscriptPages = {
      hasMore: false,
      loadingOlder: false,
      loadOlder: () => undefined,
    };
    render(
      <MessageScrollerProvider>
        <Transcript botName="Chief" timeline={[]} pages={pages} empty={<p>Say hi</p>} />
      </MessageScrollerProvider>,
    );
    expect(screen.getByText("Say hi")).toBeInTheDocument();
  });
});

describe("Past chat transcript", () => {
  const bot: Bot = {
    id: "b1",
    conversationId: "c2",
    name: "Chief",
    description: "",
    systemPrompt: "",
    modelId: "m",
    lastReadAt: null,
    lastActivityAt: "2026-10-30T01:00:00.000Z",
    lastMessagePreview: null,
    toolPermissions: {},
    skillIds: [],
    connectionIds: [],
    memoryEnabled: true,
    autoReview: false,
    browserProfile: "shared",
    pinnedAt: null,
    guestIds: [],
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  };

  it("renders a waiting approval and Question without actions", async () => {
    pastChatMock.mockResolvedValue({
      chat: {
        id: "chat-1",
        title: "Old chat",
        startedAt: "2026-10-30T00:00:00.000Z",
        endedAt: "2026-10-30T01:00:00.000Z",
        lastMessagePreview: null,
        messageCount: 2,
      },
      state: {
        messages: [
          msg(1),
          msg(2, {
            toolCalls: [
              {
                id: "t1",
                name: "delete_task",
                args: {},
                status: "awaiting_approval",
                taskId: 7,
              },
              {
                id: "t2",
                name: "ask_owner",
                args: {},
                status: "awaiting_answer",
                taskId: 8,
                questions: [{ question: "Which one?" }],
              },
            ],
          }),
        ],
        hasMore: false,
      },
      runs: [],
    });
    render(
      <ConfirmProvider>
        <MemoryRouter initialEntries={["/chats/b1/past/chat-1"]}>
          <Routes>
            <Route
              path="/chats/b1/past/chat-1"
              element={<PastChatPane bot={bot} chatId="chat-1" />}
            />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>,
    );
    expect(await screen.findByText("message 1")).toBeInTheDocument();
    expect(document.querySelector('[data-waiting="approval:7"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByTestId("question-card")).toBeNull();
    expect(screen.getAllByText(/not answered/).length).toBeGreaterThanOrEqual(1);
  });
});
