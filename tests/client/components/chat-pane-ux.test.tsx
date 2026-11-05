/**
 * @vitest-environment jsdom
 *
 * Chat composer/UX fixes: mobile Enter inserts a newline instead of sending
 * (issue #1), sending scrolls the transcript to the end (issue #2a), and the
 * transcript shows a WhatsApp-style "New messages" divider above the first
 * unread reply (issue #3). Also: one Stop/Send action button, Escape stops,
 * per-bot drafts, no empty-state or "Reconnecting…" flash before the first
 * snapshot, the typing indicator, and no "New messages" flag on live replies.
 * The SSE store is mocked so no server is involved.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import type { Bot, ModelInfo } from "@/lib/bots-api";

const sendMock = vi.fn().mockResolvedValue(undefined);
const readMock = vi.fn().mockResolvedValue(undefined);
const abortMock = vi.fn().mockResolvedValue(undefined);
const pastChatsMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: (...args: unknown[]) => sendMock(...args),
    abort: (...args: unknown[]) => abortMock(...args),
    reset: vi.fn(),
    read: () => readMock(),
    capabilities: vi.fn().mockResolvedValue([]),
    pastChats: (...args: unknown[]) => pastChatsMock(...args),
  },
}));

vi.mock("@/lib/sse", () => ({
  subscribeSse: vi.fn(() => ({ close: () => undefined })),
}));

const model: ModelInfo = {
  id: "test-model",
  name: "Test Model",
  family: "other",
  reasoning: false,
  contextWindow: 128000,
};

const HOST: Bot = {
  id: "host",
  conversationId: "c1",
  name: "Host Bot",
  description: "",
  systemPrompt: "",
  modelId: "test-model",
  lastReadAt: null,
  lastActivityAt: new Date().toISOString(),
  lastMessagePreview: null,
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
  memoryEnabled: true,
  pinnedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function seedStore(opts: { lastReadAt?: string | null } = {}) {
  useBotsStore.setState({
    bots: [
      {
        ...HOST,
        unread: false,
        replying: false,
        approvals: 0,
        questions: 0,
        pinnedAt: null,
        lastReadAt: opts.lastReadAt ?? null,
      },
    ],
    gatewayConfigured: true,
    chats: {},
  });
}

function renderPane(bot: Bot = HOST) {
  render(
    <BrowserRouter>
      <ChatPane
        bot={bot}
        models={[model]}
        gatewayConfigured
        onEditBot={() => {}}
        onBotReset={() => {}}
      />
    </BrowserRouter>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

const user = userEvent.setup();

beforeEach(() => {
  sendMock.mockClear();
  pastChatsMock.mockResolvedValue([]);
  readMock.mockClear();
  abortMock.mockClear();
  localStorage.clear();
});

describe("ChatPane composer — Enter behavior by pointer type", () => {
  it("sends on Enter with a fine (desktop) pointer", async () => {
    seedStore();
    const composer = renderPane();
    await user.type(composer, "hello desktop{Enter}");
    await waitFor(() => expect(sendMock).toHaveBeenCalledOnce());
    expect(composer.value).toBe("");
  });

  it("inserts a newline on Enter with a coarse (touch) pointer and sends only via the button", async () => {
    seedStore();
    // jsdom has no matchMedia; stand in with a stub whose `matches` reports
    // the coarse-pointer query as active.
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    const mediaLike = {
      matches: false,
      media: "(pointer: coarse)",
      onchange: null,
      addListener: (l: (e: { matches: boolean }) => void) => listeners.push(l),
      removeListener: () => undefined,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l),
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        ...mediaLike,
        matches: query === "(pointer: coarse)",
      })),
    );
    try {
      const composer = renderPane();
      await user.type(composer, "hello mobile{Enter}second line");
      expect(sendMock).not.toHaveBeenCalled();
      expect(composer.value).toBe("hello mobile\nsecond line");

      await user.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() => expect(sendMock).toHaveBeenCalledOnce());
      expect(sendMock.mock.calls[0]![2]).toBe("hello mobile\nsecond line");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ChatPane transcript — unread divider", () => {
  function seedTranscript(lastReadAt: string) {
    seedStore({ lastReadAt });
    useBotsStore.setState({ chats: {} });
    useBotsStore.getState().connectChat("host");
    useBotsStore.getState().applyChatEvent("host", {
      type: "snapshot",
      state: {
        messages: [
          { id: "u1", role: "user", text: "read question", status: "done", createdAt: 1_000 },
          {
            id: "a1",
            role: "assistant",
            text: "read answer",
            status: "done",
            createdAt: 2_000,
          },
          {
            id: "a2",
            role: "assistant",
            text: "unread reply",
            status: "done",
            createdAt: 3_000,
          },
        ],
        busy: false,
        queued: [],
      },
    });
  }

  it("shows the divider above the first message newer than the read marker", () => {
    seedTranscript(new Date(1_500).toISOString()); // u1 read; a1 + a2 unread
    renderPane();
    const divider = screen.getByTestId("unread-divider");
    expect(divider).toHaveTextContent("New messages");
    expect(divider.nextElementSibling).toHaveAttribute("data-message-id", "a1");
  });

  it("shows no divider when everything is read", () => {
    seedTranscript(new Date(4_000).toISOString());
    renderPane();
    expect(screen.queryByTestId("unread-divider")).not.toBeInTheDocument();
  });
});

describe("ChatPane composer — one action button", () => {
  function seedBusy(busy: boolean) {
    seedStore();
    useBotsStore.getState().connectChat("host");
    useBotsStore.getState().applyChatEvent("host", {
      type: "snapshot",
      state: {
        messages: [{ id: "u1", role: "user", text: "hi", status: "done", createdAt: 1_000 }],
        busy,
        queued: [],
      },
    });
  }

  it("shows only Stop while replying with nothing typed, and Steer once text is typed", async () => {
    seedBusy(true);
    const composer = renderPane();
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send message|steer the reply/i })).toBeNull();

    await user.type(composer, "also this");
    expect(screen.getByRole("button", { name: "Steer the reply" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("shows only Send when idle", () => {
    seedBusy(false);
    renderPane();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("stops the reply on Escape and shows the stop as pending until the run ends", async () => {
    seedBusy(true);
    const composer = renderPane();
    composer.focus();
    await user.keyboard("{Escape}");
    expect(abortMock).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: "Stopping" })).toBeDisabled();

    // A second press while stopping does not abort again.
    await user.keyboard("{Escape}");
    expect(abortMock).toHaveBeenCalledOnce();
  });

  it("keeps an unsent draft per bot across remounts and clears it on send", async () => {
    seedStore();
    const composer = renderPane();
    await user.type(composer, "half-written thought");
    cleanup();

    // Another bot starts blank and keeps its own draft.
    const other = { ...HOST, id: "other", conversationId: "c2", name: "Other Bot" };
    const otherComposer = renderPane(other);
    expect(otherComposer.value).toBe("");
    await user.type(otherComposer, "a different thought");
    cleanup();

    const again = renderPane();
    expect(again.value).toBe("half-written thought");
    await user.type(again, "{Enter}");
    await waitFor(() => expect(sendMock).toHaveBeenCalledOnce());
    cleanup();

    expect(renderPane().value).toBe("");
    cleanup();
    expect(renderPane(other).value).toBe("a different thought");
  });
});

describe("ChatPane transcript — loading and activity", () => {
  it("shows neither the empty state nor a reconnecting notice before the first snapshot", () => {
    seedStore();
    renderPane();
    expect(screen.queryByText(/say hi/i)).toBeNull();
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
  });

  it("shows the empty state once an empty snapshot arrives", async () => {
    seedStore();
    renderPane();
    act(() =>
      useBotsStore.getState().applyChatEvent("host", {
        type: "snapshot",
        state: { messages: [], busy: false, queued: [] },
      }),
    );
    expect(await screen.findByText(/say hi/i)).toBeInTheDocument();
  });

  it("shows a typing indicator while the bot works on a reply with no output yet", () => {
    seedStore();
    useBotsStore.getState().connectChat("host");
    useBotsStore.getState().applyChatEvent("host", {
      type: "snapshot",
      state: {
        messages: [{ id: "u1", role: "user", text: "hi", status: "done", createdAt: 1_000 }],
        busy: true,
        queued: [],
      },
    });
    renderPane();
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();

    // The first token arrives: the streaming reply replaces the dots.
    act(() =>
      useBotsStore.getState().applyChatEvent("host", {
        type: "upsert",
        message: {
          id: "a1",
          role: "assistant",
          text: "Hel",
          status: "streaming",
          createdAt: 2_000,
        },
      }),
    );
    expect(screen.queryByTestId("typing-indicator")).toBeNull();
  });

  it("does not flag a reply that arrives while the chat is open as a new message", () => {
    seedStore({ lastReadAt: new Date(1_500).toISOString() });
    useBotsStore.getState().connectChat("host");
    useBotsStore.getState().applyChatEvent("host", {
      type: "snapshot",
      state: {
        messages: [
          { id: "u1", role: "user", text: "old", status: "done", createdAt: 1_000 },
          { id: "a1", role: "assistant", text: "old reply", status: "done", createdAt: 1_200 },
        ],
        busy: false,
        queued: [],
      },
    });
    renderPane();
    act(() => {
      const { applyChatEvent } = useBotsStore.getState();
      applyChatEvent("host", {
        type: "upsert",
        message: { id: "u2", role: "user", text: "new", status: "done", createdAt: 5_000 },
      });
      applyChatEvent("host", {
        type: "upsert",
        message: { id: "a2", role: "assistant", text: "live", status: "done", createdAt: 6_000 },
      });
    });
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.queryByTestId("unread-divider")).toBeNull();
  });
});

describe("ChatPane header", () => {
  it("keeps the header to the name and two quiet icons, no overflow menu", () => {
    seedStore();
    renderPane();
    expect(screen.getByRole("button", { name: "Edit Host Bot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a new chat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bot menu" })).toBeNull();
  });

  it("disables new chat on an empty conversation and confirms it otherwise", async () => {
    seedStore();
    useBotsStore.getState().connectChat("host");
    useBotsStore.getState().applyChatEvent("host", {
      type: "snapshot",
      state: { messages: [], busy: false, queued: [] },
    });
    renderPane();
    const newChat = screen.getByRole("button", { name: "Start a new chat" });
    expect(newChat).toBeDisabled();

    act(() =>
      useBotsStore.getState().applyChatEvent("host", {
        type: "upsert",
        message: { id: "u1", role: "user", text: "hi", status: "done", createdAt: 1_000 },
      }),
    );
    expect(newChat).toBeEnabled();
    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "Start a new chat?" })).toBeInTheDocument();
  });

  it("shows Chat history only once the bot has a past chat, and lists it", async () => {
    seedStore();
    pastChatsMock.mockResolvedValue([
      {
        id: "c1",
        title: "Goa trip",
        startedAt: "2026-10-12T10:00:00.000Z",
        endedAt: "2026-10-20T10:00:00.000Z",
        lastMessagePreview: "Booked the 6:40 flight",
        messageCount: 34,
      },
    ]);
    renderPane();
    const toggle = await screen.findByRole("button", { name: "Chat history" });
    await user.click(toggle);
    expect(await screen.findByText("Goa trip")).toBeInTheDocument();
    expect(screen.getByText(/34 messages/)).toBeInTheDocument();
  });
});
