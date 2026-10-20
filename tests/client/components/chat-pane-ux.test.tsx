/**
 * @vitest-environment jsdom
 *
 * Chat composer/UX fixes: mobile Enter inserts a newline instead of sending
 * (issue #1), sending scrolls the transcript to the end (issue #2a), and the
 * transcript shows a WhatsApp-style "New messages" divider above the first
 * unread reply (issue #3). The SSE store is mocked so no server is involved.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import type { Bot, ModelInfo } from "@/lib/bots-api";

const sendMock = vi.fn().mockResolvedValue(undefined);
const readMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: (...args: unknown[]) => sendMock(...args),
    abort: vi.fn(),
    reset: vi.fn(),
    read: () => readMock(),
    capabilities: vi.fn().mockResolvedValue([]),
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
  toolkits: [],
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
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
        lastReadAt: opts.lastReadAt ?? null,
      },
    ],
    gatewayConfigured: true,
    chats: {},
  });
}

function renderPane() {
  render(
    <BrowserRouter>
      <ChatPane
        bot={HOST}
        models={[model]}
        gatewayConfigured
        onEditBot={() => {}}
        onBotDeleted={() => {}}
        onBotReset={() => {}}
      />
    </BrowserRouter>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

const user = userEvent.setup();

beforeEach(() => {
  sendMock.mockClear();
  readMock.mockClear();
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
      },
    } as never);
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
