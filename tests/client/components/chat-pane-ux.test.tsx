/**
 * @vitest-environment jsdom
 *
 * Chat composer/UX: mobile Enter inserts a newline instead of sending
 * (issue #1), one Stop/Send action button, Escape stops, per-bot drafts,
 * and the header's New chat and /new. The transcript renders the chat view: the
 * "New messages" divider (issue #3), the empty state, the typing dots,
 * Echoes and held messages; what the view says when is tested on the pure
 * session (chat-session.test.ts). The bot stream is a fake (fakes/sse.ts),
 * so no server is involved.
 */
import React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import { chatSessions } from "@/store/chats";
import type { Bot, PastChatList, SendMessageBody } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import type { ChatMessage } from "@/lib/chat-types";
import { botStream, openedPaths } from "../fakes/sse";
import { ApiFailure } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";
import { chatBackend } from "./chat-backend";
import { signedInAs, viewerLoaded } from "../fakes/viewer";
import type { PeopleMe } from "../../../apps/web/src/shared/api/people";

let api: ReturnType<typeof chatBackend>;

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
  projectId: null,
  pinnedAt: null,
  guestIds: [],
  chatStartedAt: new Date().toISOString(),
  memoryCapturedThrough: null,
  connectionCapabilities: [],
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

function snapshot(messages: ChatMessage[], busy = false) {
  botStream("host").send({
    type: "snapshot",
    state: { messages, busy, queued: [] },
  });
}

async function renderPane(bot: Bot = HOST) {
  render(
    <AppQueryProvider>
      <BrowserRouter>
        <ChatPane bot={bot} models={[model]} canAnswer onEditBot={() => {}} />
      </BrowserRouter>
    </AppQueryProvider>,
  );
  await viewerLoaded(api);
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

const user = userEvent.setup();
const sends = () => api.sent<SendMessageBody>("POST", "/bots/host/messages");
const resets = () => api.sent("POST", "/bots/host/reset");
const aborts = () => api.sent("POST", "/bots/host/abort");
const newConversation = () =>
  api.post("/bots/host/reset", (): Bot => ({ ...HOST, conversationId: "c2" }));

beforeEach(() => {
  api = chatBackend(HOST);
  signedInAs(api, "owner");
  localStorage.clear();
});

describe("ChatPane composer — Enter behavior by pointer type", () => {
  it("sends on Enter with a fine (desktop) pointer", async () => {
    seedStore();
    const composer = await renderPane();
    await user.type(composer, "hello desktop{Enter}");
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(composer.value).toBe("");
  });

  it("inserts a newline on Enter with a coarse (touch) pointer and sends only via the button", async () => {
    seedStore();
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
      const composer = await renderPane();
      await user.type(composer, "hello mobile{Enter}second line");
      expect(sends()).toHaveLength(0);
      expect(composer.value).toBe("hello mobile\nsecond line");

      await user.click(screen.getByRole("button", { name: "Send message" }));
      await waitFor(() => expect(sends()).toHaveLength(1));
      expect(sends()[0]!.body.text).toBe("hello mobile\nsecond line");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ChatPane transcript", () => {
  it("draws the New messages divider above the first reply that arrived while away", async () => {
    seedStore({ lastReadAt: new Date(1_500).toISOString() });
    await renderPane();
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
    await renderPane();
    expect(screen.queryByText(/say hi/i)).toBeNull();
    expect(screen.queryByText(/reconnecting/i)).toBeNull();
    snapshot([]);
    expect(await screen.findByText(/say hi/i)).toBeInTheDocument();
  });

  it("shows typing dots until the reply's first token arrives", async () => {
    seedStore();
    await renderPane();
    snapshot([done("u1", "user", "hi", 1_000)], true);
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument();
    botStream("host").send({
      type: "upsert",
      message: {
        id: "a1",
        role: "assistant",
        text: "Hel",
        status: "streaming",
        createdAt: 2_000,
      },
    });
    expect(screen.queryByTestId("typing-indicator")).toBeNull();
  });

  it("draws an Echo in the transcript and a held message over the composer, with its cancel", async () => {
    seedStore();
    api.post("/bots/host/messages", () => new Promise(() => undefined));
    const composer = await renderPane();
    snapshot([done("u1", "user", "hi", 1_000)], true);
    await user.type(composer, "also this{Enter}");
    expect(await screen.findByText("also this")).toBeInTheDocument();
    expect(screen.queryByTestId("queued-bubble")).toBeNull();

    const requestId = sends()[0]!.body.requestId;
    botStream("host").send({
      type: "queued",
      items: [{ requestId, mode: "steer", text: "also this" }],
    });
    const row = screen.getByTestId("queued-bubble");
    expect(row).toHaveAttribute("data-mode", "steer");
    expect(row).toHaveTextContent("Steeringalso this");
    await user.click(screen.getByRole("button", { name: "Cancel this message" }));
    expect(api.sent("DELETE", `/bots/host/messages/${requestId}`)).toHaveLength(1);
  });
});

describe("ChatPane composer — one action button", () => {
  async function renderBusy(busy: boolean) {
    seedStore();
    const composer = await renderPane();
    snapshot([done("u1", "user", "hi", 1_000)], busy);
    return composer;
  }

  it("shows only Stop while replying with nothing typed, and Steer once text is typed", async () => {
    const composer = await renderBusy(true);
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send message|steer the reply/i })).toBeNull();

    await user.type(composer, "also this");
    expect(screen.getByRole("button", { name: "Steer the reply" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("shows only Send when idle", async () => {
    await renderBusy(false);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("stops the reply on Escape and shows the stop as pending until the run ends", async () => {
    const composer = await renderBusy(true);
    composer.focus();
    await user.keyboard("{Escape}");
    expect(aborts()).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Stopping" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(aborts()).toHaveLength(1);
  });

  it("keeps an unsent draft per bot across remounts and clears it on send", async () => {
    seedStore();
    const composer = await renderPane();
    await user.type(composer, "half-written thought");
    cleanup();

    const other = {
      ...HOST,
      id: "other",
      conversationId: "c2",
      name: "Other Bot",
    };
    const otherComposer = await renderPane(other);
    expect(otherComposer.value).toBe("");
    await user.type(otherComposer, "a different thought");
    cleanup();

    const again = await renderPane();
    expect(again.value).toBe("half-written thought");
    await user.type(again, "{Enter}");
    await waitFor(() => expect(sends()).toHaveLength(1));
    cleanup();

    expect((await renderPane()).value).toBe("");
    cleanup();
    expect((await renderPane(other)).value).toBe("a different thought");
  });

  it("gives a refused message back as the draft even when the chat was left before the refusal", async () => {
    seedStore();
    let refuse: (reason: Error) => void = () => undefined;
    api.post("/bots/host/messages", () => new Promise((_resolve, reject) => (refuse = reject)));
    const composer = await renderPane();
    await user.type(composer, "do not lose me{Enter}");
    await waitFor(() => expect(sends()).toHaveLength(1));
    cleanup();

    await act(async () => refuse(new ApiFailure(500, "The bot is not reachable")));

    const again = await renderPane();
    await waitFor(() => expect(again.value).toBe("do not lose me"));
  });
});

describe("ChatPane header", () => {
  it("keeps the header to the bot menu and three quiet icons: live view, Past chats and New chat", async () => {
    seedStore();
    await renderPane({ ...HOST, description: "Plans trips" });
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("button", { name: "Host Bot menu" })).toBeInTheDocument();
    expect(
      within(header)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Open menu", "Host Bot menu", "Open live view", "Past chats", "Start a new chat"]);
    expect(within(header).queryByText("Test Model")).toBeNull();
    expect(within(header).queryByText("Plans trips")).toBeNull();
  });

  it("opens Bot settings from the bot menu, which has no YOLO row", async () => {
    seedStore();
    const onEditBot = vi.fn();
    render(
      <AppQueryProvider>
        <BrowserRouter>
          <ChatPane bot={HOST} models={[model]} canAnswer onEditBot={onEditBot} />
        </BrowserRouter>
      </AppQueryProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Host Bot menu" }));
    expect(screen.queryByTestId("yolo-toggle")).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: "Bot settings" }));
    expect(onEditBot).toHaveBeenCalledOnce();
  });

  it("shows YOLO as a chip in the composer, as Code's composer does", async () => {
    seedStore();
    await renderPane();
    snapshot([]);
    const chip = screen.getByRole("button", { name: "YOLO" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(await screen.findByRole("dialog", { name: "Turn on YOLO mode?" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    botStream("host").send({ type: "yolo", on: true });
    await waitFor(() => expect(chip).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByTestId("yolo-banner")).toBeNull();
  });

  it("disables new chat on an empty conversation and starts one without asking otherwise", async () => {
    seedStore();
    newConversation();
    await renderPane();
    snapshot([]);
    const newChat = screen.getByRole("button", { name: "Start a new chat" });
    expect(newChat).toBeDisabled();

    botStream("host").send({
      type: "upsert",
      message: done("u1", "user", "hi", 1_000),
    });
    expect(newChat).toBeEnabled();
    await user.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    await waitFor(() => expect(resets()).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Start a new chat?" })).toBeNull();
  });

  it("New chat reopens the chat on the bot's fresh conversation, the old transcript gone", async () => {
    seedStore();
    newConversation();
    useBotsStore.setState({ fullBots: { host: HOST } });
    function Live() {
      const bot = useBotsStore((s) => s.fullBots.host) ?? HOST;
      return <ChatPane bot={bot} models={[model]} canAnswer onEditBot={() => {}} />;
    }
    render(
      <AppQueryProvider>
        <BrowserRouter>
          <Live />
        </BrowserRouter>
      </AppQueryProvider>,
    );
    await viewerLoaded(api);
    snapshot([done("u1", "user", "the old conversation", 1_000)]);
    const opens = openedPaths.length;

    await user.click(screen.getByRole("button", { name: "Start a new chat" }));
    await waitFor(() => expect(openedPaths.length).toBe(opens + 1));
    expect(resets()).toHaveLength(1);
    expect(screen.queryByText("the old conversation")).toBeNull();
    snapshot([]);
    expect(await screen.findByText(/say hi/i)).toBeInTheDocument();
  });

  it("/new in the composer starts a new chat without the confirm and sends nothing", async () => {
    seedStore();
    newConversation();
    const composer = await renderPane();
    snapshot([done("u1", "user", "the old conversation", 1_000)]);

    await user.type(composer, " /new {Enter}");
    await waitFor(() => expect(resets()).toHaveLength(1));
    expect(sends()).toHaveLength(0);
    expect(composer.value).toBe("");
    expect(screen.queryByRole("dialog", { name: "Start a new chat?" })).toBeNull();
  });

  it("/new keeps the draft until the chat and the account have loaded", async () => {
    seedStore();
    newConversation();
    let answer: (value: PeopleMe) => void = () => undefined;
    api.get("/people/me", () => new Promise<PeopleMe>((resolve) => (answer = resolve)));
    const composer = await renderPane();

    await user.type(composer, "/new{Enter}");
    expect(composer.value).toBe("/new");
    expect(resets()).toHaveLength(0);
    expect(sends()).toHaveLength(0);

    snapshot([done("u1", "user", "the old conversation", 1_000)]);
    await user.keyboard("{Enter}");
    expect(composer.value).toBe("/new");
    expect(resets()).toHaveLength(0);

    await act(async () => answer({ guest: false }));
    await waitFor(async () => {
      await user.keyboard("{Enter}");
      expect(resets()).toHaveLength(1);
    });
    expect(composer.value).toBe("");
  });

  it("lists past chats on the bot menu's Chat history page", async () => {
    seedStore();
    api.get("/bots/host/chats", (): PastChatList => ({
      chats: [
        {
          id: "c1",
          title: "Goa trip",
          startedAt: "2026-10-12T10:00:00.000Z",
          endedAt: "2026-10-20T10:00:00.000Z",
          lastMessagePreview: "Booked the 6:40 flight",
          messageCount: 34,
        },
      ],
    }));
    await renderPane();
    await user.click(screen.getByRole("button", { name: "Host Bot menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Chat history" }));
    expect(await screen.findByText("Goa trip")).toBeInTheDocument();
    expect(screen.getByText(/34 messages/)).toBeInTheDocument();
  });

  it("says so on the history page when there is no past chat yet", async () => {
    seedStore();
    await renderPane();
    await user.click(screen.getByRole("button", { name: "Host Bot menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Chat history" }));
    expect(
      await screen.findByText("No past chats yet. Starting a new chat keeps this one here."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("past-chat-item")).toBeNull();
  });
});
