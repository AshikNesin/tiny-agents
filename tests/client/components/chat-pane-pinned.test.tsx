/**
 * @vitest-environment jsdom
 *
 * `ChatPane` pinned state by state: the element tree with roles, names, test
 * ids and text, and the whole markup, for the owner's and a guest's pane,
 * the model warnings, a shared chat, YOLO on, messages held over the
 * composer, the file-drop overlay, the two confirmations, the bot menu
 * opened on Chat history by `?history=1`, and the live-view toggle and tabs
 * in each state (no computer, a computer, the bot using either). Recorded on
 * the one-file pane before it was split (docs/rewrite/PLAN.md row 5.6), so
 * the split must render each the same. The live panels are stand-ins (their
 * own pins are live-panel-surfaces.test.tsx); markdown is a stand-in; the
 * bot stream is a fake (fakes/sse.ts).
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import { chatSessions } from "@/store/chats";
import { usePeopleStore } from "@/store/people";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import type { ChatMessage, QueuedMessage } from "@/lib/chat-types";
import { botStream } from "../fakes/sse";
import { markup, outline } from "../dom-outline";

const api = vi.hoisted(() => ({
  computerStatus: vi.fn(),
  setYolo: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    reset: (...args: unknown[]) => api.reset(...args),
    withdraw: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue(undefined),
    capabilities: vi.fn().mockResolvedValue([]),
    pastChats: vi.fn().mockResolvedValue([]),
    computerStatus: (...args: unknown[]) => api.computerStatus(...args),
    setYolo: (...args: unknown[]) => api.setYolo(...args),
    uploadUrl: (id: string) => `/api/v1/uploads/${id}/content`,
  },
}));
vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-stand-in="streamdown">{children}</div>
  ),
}));
vi.mock("@/components/BrowserPanel", () => ({
  BrowserPanel: ({ tabs, onClose }: { tabs?: React.ReactNode; onClose: () => void }) => (
    <aside data-stand-in="browser-panel">
      {tabs}
      <button type="button" onClick={onClose}>
        Close browser stand-in
      </button>
    </aside>
  ),
}));
vi.mock("@/components/ComputerPanel", () => ({
  ComputerPanel: ({ tabs, onClose }: { tabs?: React.ReactNode; onClose: () => void }) => (
    <aside data-stand-in="computer-panel">
      {tabs}
      <button type="button" onClick={onClose}>
        Close computer stand-in
      </button>
    </aside>
  ),
}));

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

const NOW = new Date().toISOString();
const HOST: Bot = {
  id: "host",
  conversationId: "c1",
  name: "Host Bot",
  description: "Helps with things",
  systemPrompt: "",
  modelId: "test-model",
  lastReadAt: null,
  lastActivityAt: NOW,
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
  chatStartedAt: NOW,
  memoryCapturedThrough: null,
  connectionCapabilities: [],
  createdAt: NOW,
  updatedAt: NOW,
};

const T = Date.now() - 10 * 60_000;
const done = (id: string, role: ChatMessage["role"], text: string, at = T) =>
  ({ id, role, text, status: "done", createdAt: at }) satisfies ChatMessage;

const using = (name: string, status: "running" | "awaiting_takeover" = "running"): ChatMessage => ({
  id: `a-${name}`,
  role: "assistant",
  text: "",
  status: "streaming",
  createdAt: T,
  toolCalls: [
    {
      id: "c1",
      name,
      args: {},
      status,
      ...(status === "awaiting_takeover"
        ? { taskId: 3, takeover: { status: "pending" as const, reason: "Captcha." } }
        : {}),
    },
  ],
});

function seed({ providers = [] }: { providers?: { enabled: boolean }[] } = {}) {
  useBotsStore.setState({
    bots: [{ ...HOST, unread: false, replying: false, approvals: 0, questions: 0 }],
    canAnswer: true,
    fullBots: {},
    providers: providers as never,
    defaultModel: undefined as never,
  });
  chatSessions.store.setState({ sessions: {} });
}

function mount(
  bot: Bot = HOST,
  { canAnswer = true, path = "/chats/host" }: { canAnswer?: boolean; path?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChatPane bot={bot} models={[model]} canAnswer={canAnswer} onEditBot={() => {}} />
    </MemoryRouter>,
  );
}

function open(messages: ChatMessage[], busy = false, queued: QueuedMessage[] = []) {
  botStream("host").send({ type: "snapshot", state: { messages, busy, queued } });
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

function pin(name?: string) {
  const root = document.body;
  expect(outline(root)).toMatchSnapshot(name ? `${name} outline` : "outline");
  expect(markup(root)).toMatchSnapshot(name ? `${name} markup` : "markup");
}

const user = userEvent.setup();

beforeEach(() => {
  api.computerStatus.mockReset().mockResolvedValue({ configured: false });
  api.setYolo.mockReset().mockResolvedValue({ on: true });
  api.reset.mockReset();
  usePeopleStore.setState({ role: "owner" });
  localStorage.clear();
});

describe("ChatPane, pinned", () => {
  it("before the first snapshot", async () => {
    seed();
    mount();
    await settle();
    pin();
  });

  it("an empty chat", async () => {
    seed();
    mount();
    open([]);
    await settle();
    pin();
  });

  it("a conversation", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi"), done("a1", "assistant", "hello")]);
    await settle();
    pin();
  });

  it("a guest's pane", async () => {
    seed();
    usePeopleStore.setState({ role: "guest" });
    mount();
    open([done("u1", "user", "hi")]);
    botStream("host").send({ type: "yolo", on: true });
    await settle();
    pin();
  });

  it("no model is set up", async () => {
    seed();
    mount(HOST, { canAnswer: false });
    open([]);
    await settle();
    pin();
  });

  it("no model can run", async () => {
    seed({ providers: [{ enabled: true }] });
    mount(HOST, { canAnswer: false });
    open([]);
    await settle();
    pin();
  });

  it("the bot's model is not in the catalog", async () => {
    seed();
    mount({ ...HOST, modelId: "gone" });
    open([]);
    await settle();
    pin();
  });

  it("a shared chat", async () => {
    seed();
    mount({ ...HOST, guestIds: [5] });
    open([]);
    await settle();
    pin();
  });

  it("YOLO on", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi")]);
    botStream("host").send({ type: "yolo", on: true });
    await settle();
    pin();
  });

  it("messages held over the composer", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi")], true, [
      { requestId: "q1", mode: "steer", text: "this too" },
      {
        requestId: "q2",
        mode: "followUp",
        text: "and later",
        attachments: [
          { uploadId: "u1", kind: "file", name: "a.txt", mimeType: "text/plain", size: 3 },
        ],
      },
    ]);
    await settle();
    pin();
  });

  it("the file-drop overlay", async () => {
    seed();
    mount();
    open([]);
    await settle();
    const pane = screen.getByRole("banner").parentElement!;
    fireEvent.dragEnter(pane, { dataTransfer: { types: ["Files"], files: [] } });
    pin("dragging");
    fireEvent.dragLeave(pane, { dataTransfer: { types: ["Files"], files: [] } });
    pin("left");
  });

  it("the New chat confirmation", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi")]);
    await settle();
    await user.click(screen.getByRole("button", { name: "Start a new chat" }));
    pin();
  });

  it("the New chat shortcut", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi")]);
    await settle();
    fireEvent.keyDown(window, { key: "O", shiftKey: true, ctrlKey: true });
    await screen.findByRole("dialog");
    pin();
  });

  it("the YOLO confirmation", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi")]);
    await settle();
    await user.click(screen.getByRole("button", { name: "YOLO" }));
    await screen.findByRole("dialog");
    pin();
  });

  it("?history=1 opens the bot menu on Chat history", async () => {
    seed();
    mount(HOST, { path: "/chats/host?history=1" });
    open([]);
    await settle();
    await settle();
    pin();
  });

  it("a computer: the toggle, then the tabs", async () => {
    seed();
    api.computerStatus.mockResolvedValue({ configured: true });
    mount();
    open([]);
    await settle();
    pin("closed");
    await user.click(screen.getByTestId("live-view-toggle"));
    pin("browser in front");
    await user.click(screen.getByTestId("live-view-tab-computer"));
    pin("computer in front");
    await user.click(screen.getByTestId("live-view-toggle"));
    pin("closed again");
  });

  it("the bot using the browser leaves its panel closed and lights the toggle", async () => {
    seed();
    mount();
    open([using("browser_navigate")]);
    await settle();
    expect(document.querySelector("[data-stand-in=browser-panel]")).toBeNull();
    pin("closed while in use");
    await user.click(screen.getByTestId("live-view-toggle"));
    pin("opened from the toggle");
  });

  it("the bot using the computer, with a computer", async () => {
    seed();
    api.computerStatus.mockResolvedValue({ configured: true });
    mount();
    open([using("computer_click")]);
    await settle();
    expect(document.querySelector("[data-stand-in=computer-panel]")).toBeNull();
    pin("closed while in use");
    await user.click(screen.getByTestId("live-view-toggle"));
    pin("opened from the toggle");
  });

  it("a takeover request leaves the computer closed", async () => {
    seed();
    mount();
    open([using("computer_request_takeover", "awaiting_takeover")]);
    await settle();
    expect(document.querySelector("[data-stand-in=computer-panel]")).toBeNull();
    pin();
  });

  it("the transcript's Open computer brings the computer up", async () => {
    seed();
    mount();
    open([done("u1", "user", "hi")]);
    await settle();
    act(() => {
      window.dispatchEvent(new Event("tiny-agents:show-computer"));
    });
    await waitFor(() =>
      expect(document.querySelector("[data-stand-in=computer-panel]")).toBeTruthy(),
    );
    pin();
  });
});
