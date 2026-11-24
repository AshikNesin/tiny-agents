/**
 * @vitest-environment jsdom
 *
 * Chat keys: the same single-letter commands as the Code workspace. The bot
 * stream is a fake (fakes/sse.ts) and the bots API a mock, so no server is
 * involved.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import { chatSessions } from "@/store/chats";
import { usePeopleStore } from "@/store/people";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import { botStream } from "../fakes/sse";

const sendMock = vi.fn().mockResolvedValue(undefined);
const readMock = vi.fn().mockResolvedValue(undefined);
const abortMock = vi.fn().mockResolvedValue(undefined);
const resetMock = vi.fn();
const rewindMock = vi.fn();
const withdrawMock = vi.fn().mockResolvedValue(undefined);
const pastChatsMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: (...args: unknown[]) => sendMock(...args),
    abort: (...args: unknown[]) => abortMock(...args),
    reset: (...args: unknown[]) => resetMock(...args),
    rewind: (...args: unknown[]) => rewindMock(...args),
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
  projectId: null,
  pinnedAt: null,
  guestIds: [],
  chatStartedAt: new Date().toISOString(),
  memoryCapturedThrough: null,
  connectionCapabilities: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  ...HOST,
  id,
  conversationId: `c-${id}`,
  name: `Bot ${id}`,
  unread: false,
  replying: false,
  approvals: 0,
  questions: 0,
  pinnedAt: null,
  lastActivityAt: "2026-11-01T00:00:00.000Z",
  ...extra,
});

function seedStore() {
  useBotsStore.setState({
    bots: [
      entry("host", { lastActivityAt: "2026-11-03T00:00:00.000Z" }),
      entry("asks", { questions: 1 }),
      entry("older", { lastActivityAt: "2026-10-01T00:00:00.000Z" }),
      entry("approves", { approvals: 1, lastActivityAt: "2026-10-15T00:00:00.000Z" }),
    ],
    canAnswer: true,
    fullBots: {},
  });
  chatSessions.store.setState({ sessions: {} });
  usePeopleStore.setState({ role: "owner" });
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderPane() {
  render(
    <MemoryRouter initialEntries={["/chats/host"]}>
      <Where />
      <Routes>
        <Route
          path="/chats/:botId"
          element={<ChatPane bot={HOST} models={[model]} canAnswer onEditBot={() => {}} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document.body, { key, ...init });
  });
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  seedStore();
  abortMock.mockClear();
  sendMock.mockClear();
  rewindMock.mockReset();
  rewindMock.mockResolvedValue(HOST);
  localStorage.clear();
});

describe("chat keys", () => {
  it("? lists the chat's keys", () => {
    renderPane();
    press("?", { shiftKey: true });
    const keys = screen.getByTestId("code-keys");
    expect(keys).toHaveTextContent("Next bot");
    expect(keys).toHaveTextContent("Next bot that needs you");
    expect(keys).toHaveTextContent("Write to the bot");
    expect(keys).toHaveTextContent("Past chats");
  });

  it("c puts the cursor in the composer, and a letter typed there is text", () => {
    const composer = renderPane();
    (document.activeElement as HTMLElement | null)?.blur();
    press("c");
    expect(document.activeElement).toBe(composer);
    fireEvent.keyDown(composer, { key: "j" });
    expect(where()).toBe("/chats/host");
  });

  it("j and k walk the bots in the sidebar's order; u jumps to the next one that needs you", () => {
    const composer = renderPane();
    composer.blur();
    press("j");
    expect(where()).toBe("/chats/older");
    press("k");
    press("k");
    expect(where()).toBe("/chats/approves");
    press("u");
    expect(where()).toBe("/chats/asks");
  });

  it("h opens the bot's past chats", async () => {
    const composer = renderPane();
    composer.blur();
    press("h");
    expect(await screen.findByText("Chat history")).toBeInTheDocument();
  });

  it("Escape outside the composer stops a reply", async () => {
    const composer = renderPane();
    act(() => {
      botStream("host").send({ type: "snapshot", state: { messages: [], busy: true, queued: [] } });
    });
    composer.blur();
    press("Escape");
    await waitFor(() => expect(abortMock).toHaveBeenCalledWith("host"));
  });
});

describe("past chats", () => {
  it("opens from the header in one click", async () => {
    renderPane();
    fireEvent.click(screen.getByRole("button", { name: "Past chats" }));
    expect(await screen.findByText("Chat history")).toBeInTheDocument();
  });
});

describe("the last turn", () => {
  const conversation = () =>
    act(() => {
      botStream("host").send({
        type: "snapshot",
        state: {
          messages: [
            { id: "e1", role: "user", text: "Find flights", status: "done", createdAt: 1 },
            {
              id: "e2",
              role: "assistant",
              text: "Echo: Find flights",
              status: "done",
              createdAt: 2,
            },
          ],
          busy: false,
          queued: [],
        },
      });
    });

  it("t runs it again from before it", async () => {
    const composer = renderPane();
    conversation();
    composer.blur();
    press("t");

    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(rewindMock).toHaveBeenCalledWith("host", "e1");
    expect(sendMock.mock.calls.at(-1)?.[2]).toBe("Find flights");
  });

  it("e puts it in the composer, and sending goes back to before it with the edit", async () => {
    const composer = renderPane();
    conversation();
    composer.blur();
    press("e");

    expect(composer.value).toBe("Find flights");
    expect(screen.getByText(/Editing your last message/)).toBeInTheDocument();
    fireEvent.change(composer, { target: { value: "Find flights in December" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(rewindMock).toHaveBeenCalledWith("host", "e1");
    expect(sendMock.mock.calls.at(-1)?.[2]).toBe("Find flights in December");
    expect(screen.queryByText(/Editing your last message/)).not.toBeInTheDocument();
  });

  it("offers Edit and Retry on the last message itself", () => {
    renderPane();
    conversation();
    expect(screen.getByRole("button", { name: "Edit this message" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run this again" })).toBeInTheDocument();
  });
});
