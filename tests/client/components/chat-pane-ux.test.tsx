/**
 * @vitest-environment jsdom
 *
 * Chat composer/UX: mobile Enter inserts a newline instead of sending
 * (issue #1), one Stop/Send action button, Escape stops, per-bot drafts,
 * and the header's New chat. The transcript renders the chat view: the
 * "New messages" divider (issue #3), the empty state, the typing dots,
 * Echoes and held messages; what the view says when is tested on the pure
 * session (chat-session.test.ts). The bot stream is a fake (fakes/sse.ts),
 * so no server is involved.
 */
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import { chatSessions } from "@/store/chats";
import type { Bot, CatalogModel } from "@/lib/bots-api";
import type { ChatMessage } from "@/lib/chat-types";
import { botStream, openedPaths } from "../fakes/sse";

const sendMock = vi.fn().mockResolvedValue(undefined);
const readMock = vi.fn().mockResolvedValue(undefined);
const abortMock = vi.fn().mockResolvedValue(undefined);
const resetMock = vi.fn();
const withdrawMock = vi.fn().mockResolvedValue(undefined);
const pastChatsMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: (...args: unknown[]) => sendMock(...args),
    abort: (...args: unknown[]) => abortMock(...args),
    reset: (...args: unknown[]) => resetMock(...args),
    withdraw: (...args: unknown[]) => withdrawMock(...args),
    list: vi.fn().mockResolvedValue([]),
    read: () => readMock(),
    capabilities: vi.fn().mockResolvedValue([]),
    pastChats: (...args: unknown[]) => pastChatsMock(...args),
  },
}));

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const model: CatalogModel = {
  id: "test-model",
  name: "Test Model",
  providerId: "faux",
  providerName: "Faux",
  providerKind: "faux",
  upstreamId: "test-model",
  type: "chat",
  engine: "pi",
  maxOutputTokens: 16_384,
  enabled: true,
  available: true,
  reasoning: false,
  contextWindow: 128000,
  vision: false,
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
  autoReview: false,
  yoloByDefault: false,
  browserProfile: "shared",
  pinnedAt: null,
  guestIds: [],
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
    canAnswer: true,
    fullBots: {},
  });
  chatSessions.store.setState({ sessions: {} });
}

const done = (id: string, role: ChatMessage["role"], text: string, createdAt: number) =>
  ({ id, role, text, status: "done", createdAt }) satisfies ChatMessage;

/** The bot's stream opens with this transcript. */
function snapshot(messages: ChatMessage[], busy = false) {
  botStream("host").send({ type: "snapshot", state: { messages, busy, queued: [] } });
}

function renderPane(bot: Bot = HOST) {
  render(
    <BrowserRouter>
      <ChatPane bot={bot} models={[model]} canAnswer onEditBot={() => {}} />
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
  resetMock.mockReset();
  withdrawMock.mockClear();
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

describe("ChatPane transcript", () => {
  it("draws the New messages divider above the first reply that arrived while away", () => {
    seedStore({ lastReadAt: new Date(1_500).toISOString() });
    renderPane();
    snapshot([
      done("u1", "user", "read question", 1_000),
      done("a1", "assistant", "first unread reply", 2_000),
      done("a2", "assistant", "second unread reply", 3_000),
    ]);
    const divider = screen.getByTestId("unread-divider");
    expect(divider).toHaveTextContent("New messages");
    expect(divider.nextElementSibling).toHaveAttribute("data-message-id", "a1");
  });

  it("waits for the first snapshot before showing the empty state", async () => {
    seedStore();
    renderPane();
    expect(screen.queryByText(/say hi/i)).toBeNull();
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
    snapshot([]);
    expect(await screen.findByText(/say hi/i)).toBeInTheDocument();
  });

  it("shows typing dots until the reply's first token arrives", () => {
    seedStore();
    renderPane();
    snapshot([done("u1", "user", "hi", 1_000)], true);
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    botStream("host").send({
      type: "upsert",
      message: { id: "a1", role: "assistant", text: "Hel", status: "streaming", createdAt: 2_000 },
    });
    expect(screen.queryByTestId("typing-indicator")).toBeNull();
  });

  it("draws an Echo in the transcript and a held message over the composer, with its cancel", async () => {
    seedStore();
    sendMock.mockReturnValueOnce(new Promise(() => undefined));
    const composer = renderPane();
    snapshot([done("u1", "user", "hi", 1_000)], true);
    await user.type(composer, "also this{Enter}");
    expect(await screen.findByText("also this")).toBeInTheDocument();
    expect(screen.queryByTestId("queued-bubble")).toBeNull();

    // The server holds it to steer the running reply: a row, not a bubble.
    const requestId = sendMock.mock.calls[0]![1] as string;
    botStream("host").send({
      type: "queued",
      items: [{ requestId, mode: "steer", text: "also this" }],
    });
    const row = screen.getByTestId("queued-bubble");
    expect(row).toHaveAttribute("data-mode", "steer");
    expect(row).toHaveTextContent("Steeringalso this");
    await user.click(screen.getByRole("button", { name: "Cancel this message" }));
    expect(withdrawMock).toHaveBeenCalledWith("host", requestId);
  });
});

describe("ChatPane composer — one action button", () => {
  function renderBusy(busy: boolean) {
    seedStore();
    const composer = renderPane();
    snapshot([done("u1", "user", "hi", 1_000)], busy);
    return composer;
  }

  it("shows only Stop while replying with nothing typed, and Steer once text is typed", async () => {
    const composer = renderBusy(true);
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send message|steer the reply/i })).toBeNull();

    await user.type(composer, "also this");
    expect(screen.getByRole("button", { name: "Steer the reply" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("shows only Send when idle", () => {
    renderBusy(false);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("stops the reply on Escape and shows the stop as pending until the run ends", async () => {
    const composer = renderBusy(true);
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

describe("ChatPane header", () => {
  it("keeps the header to the bot menu and two quiet icons: live view and New chat", () => {
    seedStore();
    renderPane({ ...HOST, description: "Plans trips" });
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("button", { name: "Host Bot menu" })).toBeInTheDocument();
    expect(
      within(header)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Open menu", "Host Bot menu", "Open live view", "Start a new chat"]);
    // The model is the composer's chip and the description the menu's: not repeated here.
    expect(within(header).queryByText("Test Model")).toBeNull();
    expect(within(header).queryByText("Plans trips")).toBeNull();
  });

  it("opens Bot settings and the YOLO confirm from the bot menu", async () => {
    seedStore();
    const onEditBot = vi.fn();
    render(
      <BrowserRouter>
        <ChatPane bot={HOST} models={[model]} canAnswer onEditBot={onEditBot} />
      </BrowserRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Host Bot menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Bot settings" }));
    expect(onEditBot).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Host Bot menu" }));
    const yolo = await screen.findByTestId("yolo-toggle");
    expect(yolo).toHaveAttribute("aria-checked", "false");
    await user.click(yolo);
    expect(await screen.findByRole("dialog", { name: "Turn on YOLO mode?" })).toBeInTheDocument();
  });

  it("disables new chat on an empty conversation and confirms it otherwise", async () => {
    seedStore();
    renderPane();
    snapshot([]);
    const newChat = screen.getByRole("button", { name: "Start a new chat" });
    expect(newChat).toBeDisabled();

    botStream("host").send({ type: "upsert", message: done("u1", "user", "hi", 1_000) });
    expect(newChat).toBeEnabled();
    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "Start a new chat?" })).toBeInTheDocument();
  });

  it("New chat reopens the chat on the bot's fresh conversation, the old transcript gone", async () => {
    seedStore();
    const fresh = { ...HOST, conversationId: "c2" };
    resetMock.mockResolvedValueOnce(fresh);
    // As the chats page does: the pane renders the store's full row.
    useBotsStore.setState({ fullBots: { host: HOST } });
    function Live() {
      const bot = useBotsStore((s) => s.fullBots.host) ?? HOST;
      return <ChatPane bot={bot} models={[model]} canAnswer onEditBot={() => {}} />;
    }
    render(
      <BrowserRouter>
        <Live />
      </BrowserRouter>,
    );
    snapshot([done("u1", "user", "the old conversation", 1_000)]);
    const opens = openedPaths.length;

    await user.click(screen.getByRole("button", { name: "Start a new chat" }));
    await user.click(await screen.findByRole("button", { name: "New chat" }));
    await waitFor(() => expect(openedPaths.length).toBe(opens + 1));
    expect(resetMock).toHaveBeenCalledWith("host");
    expect(screen.queryByText("the old conversation")).toBeNull();
    snapshot([]);
    expect(await screen.findByText(/say hi/i)).toBeInTheDocument();
  });

  it("lists past chats on the bot menu's Chat history page", async () => {
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
    await user.click(screen.getByRole("button", { name: "Host Bot menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Chat history" }));
    expect(await screen.findByText("Goa trip")).toBeInTheDocument();
    expect(screen.getByText(/34 messages/)).toBeInTheDocument();
  });

  it("says so on the history page when there is no past chat yet", async () => {
    seedStore();
    renderPane();
    await user.click(screen.getByRole("button", { name: "Host Bot menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Chat history" }));
    expect(
      await screen.findByText("No past chats yet. Starting a new chat keeps this one here."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("past-chat-item")).toBeNull();
  });
});
